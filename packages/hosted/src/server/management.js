/**
 * management.js — REST API routes for key management, billing, and user operations.
 *
 * Mounted alongside the MCP endpoint in the Hono app.
 * Exported as a factory function to receive ctx for vault DB access.
 */

import { Hono } from "hono";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { rmSync } from "node:fs";
import {
  generateApiKey,
  hashApiKey,
  keyPrefix,
  prepareMetaStatements,
  getMetaDb,
  validateApiKey,
} from "../auth/meta-db.js";
import { isGoogleOAuthConfigured, getAuthUrl, exchangeCode, getRedirectUri } from "../auth/google-oauth.js";
import { createCheckoutSession, verifyWebhookEvent, getStripe, getTierLimits } from "../billing/stripe.js";
import { generateDek, generateDekSplitAuthority, clearDekCache } from "../encryption/keys.js";
import { decryptFromStorage } from "../encryption/vault-crypto.js";
import { unlinkSync } from "node:fs";
import { getCachedUserCtx, clearUserCtxCache } from "./user-ctx.js";
import { PER_USER_DB } from "./ctx.js";
import { pool, getUserDir } from "./user-db.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Registration Rate Limiting (SQLite-backed, survives restarts) ───────────

const RATE_LIMIT_MAX = 5;
let rateLimitPruneCounter = 0;

function getClientIp(c) {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || c.req.header("x-real-ip")
    || "unknown";
}

function checkRegistrationRate(ip) {
  const stmts = prepareMetaStatements(getMetaDb());
  const key = `reg:${ip}`;

  // Check current state
  const row = stmts.checkRateLimit.get(key);
  if (row) {
    // If window expired, the upsert will reset — just check current count
    const windowExpired = new Date(row.window_start + "Z").getTime() + 3600_000 < Date.now();
    if (!windowExpired && row.count >= RATE_LIMIT_MAX) {
      return false;
    }
  }

  // Atomically increment (or reset if window expired)
  stmts.upsertRateLimit.run(key);

  // Prune expired entries periodically (every 100 calls)
  if (++rateLimitPruneCounter % 100 === 0) {
    try { stmts.pruneRateLimits.run(); } catch {}
  }

  return true;
}

/** Exported for testing — resets all rate limit state. */
export function _resetRateLimits() {
  const db = getMetaDb();
  db.prepare("DELETE FROM rate_limits").run();
}

/**
 * Create management API routes with access to the vault context.
 * @param {object} ctx - Vault context (db, config, stmts, embed, insertVec, deleteVec)
 */
export function createManagementRoutes(ctx) {
  const api = new Hono();

  const VAULT_MASTER_SECRET = process.env.VAULT_MASTER_SECRET || null;

  // ─── Auth helper for management routes ──────────────────────────────────────

  function requireAuth(c) {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) return null;
    const user = validateApiKey(header.slice(7));
    if (!user) return null;
    // Attach client key share from X-Vault-Secret header (split-authority encryption)
    const vaultSecret = c.req.header("X-Vault-Secret");
    if (vaultSecret && vaultSecret.startsWith("cvs_")) {
      user.clientKeyShare = vaultSecret;
    }
    return user;
  }

  // ─── Current User ─────────────────────────────────────────────────────────

  /** Return the authenticated user's profile */
  api.get("/api/me", (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const stmts = prepareMetaStatements(getMetaDb());
    const row = stmts.getUserById.get(user.userId);
    if (!row) return c.json({ error: "User not found" }, 404);

    return c.json({
      userId: row.id,
      email: row.email,
      name: row.name || null,
      tier: row.tier,
      encryptionMode: row.encryption_mode || "legacy",
      createdAt: row.created_at,
    });
  });

  // ─── API Keys ───────────────────────────────────────────────────────────────

  /** List all API keys for the authenticated user */
  api.get("/api/keys", (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const stmts = prepareMetaStatements(getMetaDb());
    const keys = stmts.listUserKeys.all(user.userId);
    return c.json({ keys });
  });

  /** Create a new API key */
  api.post("/api/keys", async (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const stmts = prepareMetaStatements(getMetaDb());

    // Enforce API key count limit
    const limits = getTierLimits(user.tier);
    if (limits.apiKeys !== Infinity) {
      const existing = stmts.listUserKeys.all(user.userId);
      if (existing.length >= limits.apiKeys) {
        return c.json({ error: `API key limit reached (${limits.apiKeys}). Upgrade to Pro for unlimited keys.` }, 403);
      }
    }

    const body = await c.req.json().catch(() => ({}));
    const name = body.name || "default";

    const rawKey = generateApiKey();
    const hash = hashApiKey(rawKey);
    const prefix = keyPrefix(rawKey);
    const id = randomUUID();

    stmts.createApiKey.run(id, user.userId, hash, prefix, name);

    // Return the raw key ONCE — it cannot be retrieved again
    return c.json({
      id,
      key: rawKey,
      prefix,
      name,
      message: "Save this key — it will not be shown again.",
    }, 201);
  });

  /** Delete an API key */
  api.delete("/api/keys/:id", (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const keyId = c.req.param("id");
    const stmts = prepareMetaStatements(getMetaDb());
    const result = stmts.deleteApiKey.run(keyId, user.userId);

    if (result.changes === 0) {
      return c.json({ error: "Key not found" }, 404);
    }
    return c.json({ deleted: true });
  });

  // ─── Google OAuth ─────────────────────────────────────────────────────────

  /** Redirect to Google OAuth consent screen */
  api.get("/api/auth/google", (c) => {
    if (!isGoogleOAuthConfigured()) {
      return c.json({ error: "Google OAuth not configured" }, 503);
    }
    // Generate CSRF state token to prevent login CSRF attacks
    const state = randomUUID();
    // Store state in a short-lived cookie (5 min expiry)
    c.header("Set-Cookie", `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`);
    const url = getAuthUrl(c.req.raw, state);
    return c.redirect(url);
  });

  /** Handle Google OAuth callback — create/find user, auto-generate API key */
  api.get("/api/auth/google/callback", async (c) => {
    if (!isGoogleOAuthConfigured()) {
      return c.json({ error: "Google OAuth not configured" }, 503);
    }

    const code = c.req.query("code");
    const error = c.req.query("error");
    const appUrl = process.env.PUBLIC_URL || "";

    if (error) {
      // User denied consent or an error occurred — redirect to login with error
      return c.redirect(`${appUrl}/login?error=oauth_denied`);
    }

    if (!code) {
      return c.json({ error: "Missing authorization code" }, 400);
    }

    // Verify CSRF state parameter
    const state = c.req.query("state");
    const cookieHeader = c.req.header("cookie") || "";
    const stateCookie = cookieHeader.split(";").map((s) => s.trim()).find((s) => s.startsWith("oauth_state="));
    const expectedState = stateCookie?.split("=")[1];
    if (!state || !expectedState || state !== expectedState) {
      return c.redirect(`${appUrl}/login?error=oauth_invalid_state`);
    }
    // Clear the state cookie
    c.header("Set-Cookie", "oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");

    const redirectUri = getRedirectUri(c.req.raw);
    let profile;
    try {
      profile = await exchangeCode(code, redirectUri);
    } catch (err) {
      console.error(JSON.stringify({
        level: "error",
        context: "google_oauth",
        error: err.message,
        ts: new Date().toISOString(),
      }));
      return c.redirect(`${appUrl}/login?error=oauth_failed`);
    }

    const stmts = prepareMetaStatements(getMetaDb());
    const masterSecret = process.env.VAULT_MASTER_SECRET;

    // Check if user already exists by google_id or email
    let existingUser = stmts.getUserByGoogleId.get(profile.googleId);
    let matchedByEmail = false;
    if (!existingUser) {
      existingUser = stmts.getUserByEmail.get(profile.email);
      if (existingUser) matchedByEmail = true;
    }

    let apiKeyRaw;
    let encryptionSecret = null;

    if (existingUser) {
      // Link google_id if user was matched by email (first Google sign-in for email-registered user)
      if (matchedByEmail && !existingUser.google_id) {
        getMetaDb().prepare("UPDATE users SET google_id = ?, updated_at = datetime('now') WHERE id = ?")
          .run(profile.googleId, existingUser.id);
      }

      // Existing user — check key limit before creating a new key
      const keys = stmts.listUserKeys.all(existingUser.id);
      const limits = getTierLimits(existingUser.tier);
      if (limits.apiKeys !== Infinity && keys.length >= limits.apiKeys) {
        // At key limit — delete the oldest OAuth-generated key to make room
        const oauthKey = keys.find((k) => k.name === "google-oauth");
        if (oauthKey) {
          stmts.deleteApiKey.run(oauthKey.id, existingUser.id);
        }
      }

      apiKeyRaw = generateApiKey();
      const hash = hashApiKey(apiKeyRaw);
      const prefix = keyPrefix(apiKeyRaw);
      const keyId = randomUUID();
      stmts.createApiKey.run(keyId, existingUser.id, hash, prefix, keys.length > 0 ? "google-oauth" : "default");
    } else {
      // New user — create account with google_id + split-authority encryption
      const userId = randomUUID();
      apiKeyRaw = generateApiKey();
      const hash = hashApiKey(apiKeyRaw);
      const prefix = keyPrefix(apiKeyRaw);
      const keyId = randomUUID();

      const registerUser = getMetaDb().transaction(() => {
        stmts.createUserWithGoogle.run(userId, profile.email, profile.name, "free", profile.googleId);
        if (masterSecret) {
          const { encryptedDek, dekSalt, clientKeyShare } = generateDekSplitAuthority(masterSecret);
          encryptionSecret = clientKeyShare;
          const shareHash = createHash("sha256").update(clientKeyShare).digest("hex");
          stmts.updateUserDekSplitAuthority.run(encryptedDek, dekSalt, shareHash, userId);
        }
        stmts.createApiKey.run(keyId, userId, hash, prefix, "default");
      });

      try {
        registerUser();
      } catch (err) {
        console.error(JSON.stringify({
          level: "error",
          context: "google_oauth_registration",
          email: profile.email,
          error: err.message,
          ts: new Date().toISOString(),
        }));
        return c.redirect(`${appUrl}/login?error=registration_failed`);
      }
    }

    // Redirect to app with the API key as a token (one-time, via URL fragment)
    // Include encryption secret for new users
    const fragment = encryptionSecret
      ? `token=${apiKeyRaw}&encryption_secret=${encryptionSecret}`
      : `token=${apiKeyRaw}`;
    return c.redirect(`${appUrl}/auth/callback#${fragment}`);
  });

  // ─── User Registration (email — legacy, kept for backwards compat) ────────

  /** Register a new user and return their first API key */
  api.post("/api/register", async (c) => {
    const ip = getClientIp(c);
    if (!checkRegistrationRate(ip)) {
      return c.json({ error: "Too many registration attempts. Try again later." }, 429);
    }

    const body = await c.req.json().catch(() => ({}));
    const { email, name } = body;
    if (!email) return c.json({ error: "email is required" }, 400);
    if (!EMAIL_REGEX.test(email) || email.length > 320) {
      return c.json({ error: "Invalid email format" }, 400);
    }

    const stmts = prepareMetaStatements(getMetaDb());

    // Check if already exists
    const existing = stmts.getUserByEmail.get(email);
    if (existing) return c.json({ error: "User already exists" }, 409);

    const userId = randomUUID();
    const rawKey = generateApiKey();
    const hash = hashApiKey(rawKey);
    const prefix = keyPrefix(rawKey);
    const keyId = randomUUID();
    const masterSecret = process.env.VAULT_MASTER_SECRET;

    let encryptionSecret = null;

    // Wrap all inserts in a transaction to prevent broken user state
    const registerUser = getMetaDb().transaction(() => {
      stmts.createUser.run(userId, email, name || null, "free");
      if (masterSecret) {
        // Use split-authority encryption for new users
        const { encryptedDek, dekSalt, clientKeyShare } = generateDekSplitAuthority(masterSecret);
        encryptionSecret = clientKeyShare;
        const shareHash = createHash("sha256").update(clientKeyShare).digest("hex");
        stmts.updateUserDekSplitAuthority.run(encryptedDek, dekSalt, shareHash, userId);
      }
      stmts.createApiKey.run(keyId, userId, hash, prefix, "default");
    });

    try {
      registerUser();
    } catch (err) {
      console.error(JSON.stringify({
        level: "error",
        context: "registration",
        email,
        error: err.message,
        ts: new Date().toISOString(),
      }));
      return c.json({ error: "Registration failed. Please try again." }, 500);
    }

    const response = {
      userId,
      email,
      tier: "free",
      apiKey: {
        id: keyId,
        key: rawKey,
        prefix,
        message: "Save this key — it will not be shown again.",
      },
    };

    // Include encryption secret for split-authority users
    if (encryptionSecret) {
      response.encryptionSecret = encryptionSecret;
      response.encryptionWarning = "Save your encryption secret. It cannot be recovered if lost.";
    }

    return c.json(response, 201);
  });

  // ─── Billing ───────────────────────────────────────────────────────────────

  api.get("/api/billing/usage", async (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const stmts = prepareMetaStatements(getMetaDb());
    const requestsToday = stmts.countUsageToday.get(user.userId, "mcp_request");
    const limits = getTierLimits(user.tier);

    const userCtx = await getCachedUserCtx(ctx, user, VAULT_MASTER_SECRET);

    const entryCount = userCtx.db.prepare("SELECT COUNT(*) as c FROM vault WHERE user_id = ? OR user_id IS NULL").get(user.userId).c;
    const storageBytes = userCtx.db.prepare(
      "SELECT COALESCE(SUM(LENGTH(COALESCE(body,'')) + LENGTH(COALESCE(body_encrypted,'')) + LENGTH(COALESCE(title,'')) + LENGTH(COALESCE(meta,''))), 0) as s FROM vault WHERE user_id = ? OR user_id IS NULL"
    ).get(user.userId).s;

    return c.json({
      tier: user.tier,
      limits: {
        maxEntries: limits.maxEntries === Infinity ? "unlimited" : limits.maxEntries,
        requestsPerDay: limits.requestsPerDay === Infinity ? "unlimited" : limits.requestsPerDay,
        storageMb: limits.storageMb,
        exportEnabled: limits.exportEnabled,
      },
      usage: {
        requestsToday: requestsToday.c,
        entriesUsed: entryCount,
        storageMb: Math.round((storageBytes / (1024 * 1024)) * 100) / 100,
      },
    });
  });

  /** Create a Stripe Checkout session for Pro upgrade */
  api.post("/api/billing/checkout", async (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    if (user.tier === "pro") {
      return c.json({ error: "Already on Pro tier" }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const session = await createCheckoutSession({
      userId: user.userId,
      email: user.email,
      customerId: user.stripeCustomerId,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
    });

    if (!session) {
      return c.json({ error: "Stripe not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_PRO." }, 503);
    }

    return c.json({ url: session.url, sessionId: session.sessionId });
  });

  /** Stripe webhook endpoint */
  api.post("/api/billing/webhook", async (c) => {
    const body = await c.req.text();
    const signature = c.req.header("stripe-signature");

    if (!signature) return c.json({ error: "Missing stripe-signature" }, 400);

    const event = await verifyWebhookEvent(body, signature);
    if (!event) return c.json({ error: "Invalid webhook signature" }, 400);

    const stmts = prepareMetaStatements(getMetaDb());

    // Idempotency check — prevent double-processing retried webhooks
    const existing = stmts.getProcessedWebhook.get(event.id);
    if (existing) return c.json({ received: true, duplicate: true });

    switch (event.type) {
      case "checkout.session.completed": {
        const userId = event.data.metadata?.userId;
        const customerId = event.data.customer;
        if (userId) {
          stmts.updateUserTier.run("pro", userId);
          if (customerId) stmts.updateUserStripeId.run(customerId, userId);
          clearUserCtxCache(userId);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const customerId = event.data.customer;
        if (customerId) {
          const user = stmts.getUserByStripeCustomerId.get(customerId);
          if (user) {
            stmts.updateUserTier.run("free", user.id);
            clearUserCtxCache(user.id);
          }
        }
        break;
      }
      case "invoice.payment_failed": {
        // Log warning — Stripe retries for ~3 weeks before canceling
        const customerId = event.data.customer;
        if (customerId) {
          const user = stmts.getUserByStripeCustomerId.get(customerId);
          if (user) console.warn(JSON.stringify({
            level: "warn", event: "payment_failed",
            userId: user.id, ts: new Date().toISOString(),
          }));
        }
        break;
      }
      case "customer.subscription.updated": {
        // Track past_due status (payment issues)
        const customerId = event.data.customer;
        const status = event.data.status;
        if (customerId && (status === "past_due" || status === "unpaid")) {
          const user = stmts.getUserByStripeCustomerId.get(customerId);
          if (user) console.warn(JSON.stringify({
            level: "warn", event: "subscription_" + status,
            userId: user.id, ts: new Date().toISOString(),
          }));
        }
        break;
      }
    }

    // Mark processed + periodic cleanup
    stmts.insertProcessedWebhook.run(event.id, event.type);
    try { stmts.pruneOldWebhooks.run(); } catch {}

    return c.json({ received: true });
  });

  // ─── Teams ────────────────────────────────────────────────────────────────

  /** Create a new team — caller becomes owner */
  api.post("/api/teams", async (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json().catch(() => ({}));
    if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
    if (body.name.length > 100) return c.json({ error: "name must be 100 characters or fewer" }, 400);

    const stmts = prepareMetaStatements(getMetaDb());
    const teamId = randomUUID();

    const createTeam = getMetaDb().transaction(() => {
      stmts.createTeam.run(teamId, body.name.trim(), user.userId, "team", null);
      stmts.addTeamMember.run(teamId, user.userId, "owner");
    });

    try {
      createTeam();
    } catch (err) {
      console.error(JSON.stringify({ level: "error", context: "team_create", userId: user.userId, error: err.message, ts: new Date().toISOString() }));
      return c.json({ error: "Failed to create team" }, 500);
    }

    return c.json({ id: teamId, name: body.name.trim(), role: "owner" }, 201);
  });

  /** Get user's teams */
  api.get("/api/teams", (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const stmts = prepareMetaStatements(getMetaDb());
    const teams = stmts.getTeamsByUserId.all(user.userId);

    return c.json({
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        role: t.role,
        tier: t.tier,
        createdAt: t.created_at,
      })),
    });
  });

  /** Get team details + members */
  api.get("/api/teams/:id", (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const teamId = c.req.param("id");
    const stmts = prepareMetaStatements(getMetaDb());

    // Check membership
    const membership = stmts.getTeamMember.get(teamId, user.userId);
    if (!membership) return c.json({ error: "Team not found" }, 404);

    const team = stmts.getTeamById.get(teamId);
    if (!team) return c.json({ error: "Team not found" }, 404);

    const members = stmts.getTeamMembers.all(teamId);
    const invites = membership.role === "owner" || membership.role === "admin"
      ? stmts.getInvitesByTeam.all(teamId)
      : [];

    return c.json({
      id: team.id,
      name: team.name,
      tier: team.tier,
      role: membership.role,
      createdAt: team.created_at,
      members: members.map((m) => ({
        userId: m.user_id,
        email: m.email,
        name: m.name || null,
        role: m.role,
        joinedAt: m.joined_at,
      })),
      invites: invites.map((inv) => ({
        id: inv.id,
        email: inv.email,
        status: inv.status,
        expiresAt: inv.expires_at,
        createdAt: inv.created_at,
      })),
    });
  });

  /** Invite a user to a team (owner/admin only) */
  api.post("/api/teams/:id/invite", async (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const teamId = c.req.param("id");
    const stmts = prepareMetaStatements(getMetaDb());

    // Check caller is owner or admin
    const membership = stmts.getTeamMember.get(teamId, user.userId);
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      return c.json({ error: "Only owners and admins can invite members" }, 403);
    }

    const body = await c.req.json().catch(() => ({}));
    if (!body.email || !EMAIL_REGEX.test(body.email)) {
      return c.json({ error: "Valid email is required" }, 400);
    }

    // Check for existing pending invite
    const existing = stmts.getPendingInviteByEmail.get(teamId, body.email);
    if (existing) return c.json({ error: "A pending invite already exists for this email" }, 409);

    // Check if already a member
    const existingUser = stmts.getUserByEmail.get(body.email);
    if (existingUser) {
      const existingMember = stmts.getTeamMember.get(teamId, existingUser.id);
      if (existingMember) return c.json({ error: "User is already a team member" }, 409);
    }

    const inviteId = randomUUID();
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    stmts.createTeamInvite.run(inviteId, teamId, body.email, user.userId, token, expiresAt);

    return c.json({
      id: inviteId,
      token,
      email: body.email,
      expiresAt,
    }, 201);
  });

  /** Accept a team invite */
  api.post("/api/teams/:id/join", async (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const teamId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    if (!body.token) return c.json({ error: "token is required" }, 400);

    const stmts = prepareMetaStatements(getMetaDb());

    // Expire stale invites first
    stmts.expireOldInvites.run();

    const invite = stmts.getInviteByToken.get(body.token);
    if (!invite || invite.team_id !== teamId) {
      return c.json({ error: "Invalid or expired invite" }, 400);
    }

    // Verify the invite is for this user's email
    const userRow = stmts.getUserById.get(user.userId);
    if (!userRow || userRow.email !== invite.email) {
      return c.json({ error: "This invite is for a different email address" }, 403);
    }

    // Check not already a member
    const existing = stmts.getTeamMember.get(teamId, user.userId);
    if (existing) return c.json({ error: "Already a member of this team" }, 409);

    const acceptInvite = getMetaDb().transaction(() => {
      stmts.addTeamMember.run(teamId, user.userId, "member");
      stmts.updateInviteStatus.run("accepted", invite.id);
    });

    try {
      acceptInvite();
    } catch (err) {
      console.error(JSON.stringify({ level: "error", context: "team_join", userId: user.userId, error: err.message, ts: new Date().toISOString() }));
      return c.json({ error: "Failed to join team" }, 500);
    }

    return c.json({ joined: true, teamId, role: "member" });
  });

  /** Remove a member from a team (owner/admin only, or self-remove) */
  api.delete("/api/teams/:id/members/:userId", (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const teamId = c.req.param("id");
    const targetUserId = c.req.param("userId");
    const stmts = prepareMetaStatements(getMetaDb());

    const callerMembership = stmts.getTeamMember.get(teamId, user.userId);
    if (!callerMembership) return c.json({ error: "Team not found" }, 404);

    // Self-remove is always allowed (except owner can't leave)
    const isSelfRemove = user.userId === targetUserId;
    if (isSelfRemove && callerMembership.role === "owner") {
      return c.json({ error: "Team owner cannot leave. Transfer ownership or delete the team." }, 403);
    }

    if (!isSelfRemove && callerMembership.role !== "owner" && callerMembership.role !== "admin") {
      return c.json({ error: "Only owners and admins can remove members" }, 403);
    }

    // Can't remove owner
    const targetMembership = stmts.getTeamMember.get(teamId, targetUserId);
    if (!targetMembership) return c.json({ error: "Member not found" }, 404);
    if (targetMembership.role === "owner" && !isSelfRemove) {
      return c.json({ error: "Cannot remove the team owner" }, 403);
    }

    stmts.removeTeamMember.run(teamId, targetUserId);
    return c.json({ removed: true, userId: targetUserId });
  });

  /** Get team usage stats */
  api.get("/api/teams/:id/usage", async (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const teamId = c.req.param("id");
    const stmts = prepareMetaStatements(getMetaDb());

    const membership = stmts.getTeamMember.get(teamId, user.userId);
    if (!membership) return c.json({ error: "Team not found" }, 404);

    const team = stmts.getTeamById.get(teamId);
    if (!team) return c.json({ error: "Team not found" }, 404);

    const memberCount = stmts.countTeamMembers.get(teamId).c;

    // Count vault entries scoped to team — use user's own DB in per-user mode
    const userCtx = await getCachedUserCtx(ctx, user, VAULT_MASTER_SECRET);
    const entryCount = userCtx.db.prepare("SELECT COUNT(*) as c FROM vault WHERE team_id = ?").get(teamId).c;
    const storageBytes = userCtx.db.prepare(
      "SELECT COALESCE(SUM(LENGTH(COALESCE(body,'')) + LENGTH(COALESCE(body_encrypted,'')) + LENGTH(COALESCE(title,'')) + LENGTH(COALESCE(meta,''))), 0) as s FROM vault WHERE team_id = ?"
    ).get(teamId).s;

    return c.json({
      teamId,
      name: team.name,
      tier: team.tier,
      members: memberCount,
      usage: {
        entries: entryCount,
        storageMb: Math.round((storageBytes / (1024 * 1024)) * 100) / 100,
      },
    });
  });

  // ─── Account Deletion (GDPR) ─────────────────────────────────────────────

  api.delete("/api/account", async (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    // 1. Cancel Stripe subscription if active
    if (user.stripeCustomerId) {
      try {
        const s = await getStripe();
        if (s) {
          const subs = await s.subscriptions.list({ customer: user.stripeCustomerId, status: "active" });
          for (const sub of subs.data) await s.subscriptions.cancel(sub.id);
        }
      } catch (err) {
        console.error(JSON.stringify({
          level: "error", context: "account_deletion",
          userId: user.userId, error: err.message,
          ts: new Date().toISOString(),
        }));
      }
    }

    // 2. Delete vault entries
    if (PER_USER_DB) {
      // Per-user mode: evict from pool and delete entire user directory
      pool.evict(user.userId);
      try {
        rmSync(getUserDir(user.userId), { recursive: true, force: true });
      } catch (err) {
        console.error(`[management] Failed to delete user dir: ${err.message}`);
      }
    } else {
      // Legacy mode: delete entries row by row
      const entries = ctx.db.prepare("SELECT id, file_path, rowid FROM vault WHERE user_id = ?").all(user.userId);
      for (const entry of entries) {
        if (entry.file_path) try { unlinkSync(entry.file_path); } catch {}
        if (entry.rowid) try { ctx.deleteVec(Number(entry.rowid)); } catch {}
      }
      ctx.db.prepare("DELETE FROM vault WHERE user_id = ?").run(user.userId);
    }

    // 3. Delete meta records in transaction
    const stmts = prepareMetaStatements(getMetaDb());
    const deleteMeta = getMetaDb().transaction(() => {
      stmts.deleteUserKeys.run(user.userId);
      stmts.deleteUserUsage.run(user.userId);
      stmts.deleteUser.run(user.userId);
    });
    deleteMeta();

    // 4. Clear caches
    clearDekCache(user.userId);
    clearUserCtxCache(user.userId);

    return c.json({ deleted: true });
  });

  // ─── Vault Export (for migration) ───────────────────────────────────────────
  // NOTE: Import routes (single + bulk) are in vault-api.js with standard auth middleware

  /** Export all vault entries */
  api.get("/api/vault/export", async (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const limits = getTierLimits(user.tier);
    if (!limits.exportEnabled) {
      return c.json({ error: "Export is not available on the free tier. Upgrade to Pro." }, 403);
    }

    const userCtx = await getCachedUserCtx(ctx, user, VAULT_MASTER_SECRET);

    const rows = userCtx.db.prepare(
      `SELECT id, kind, title, body, tags, source, created_at, identity_key, expires_at, meta, body_encrypted, title_encrypted, meta_encrypted, iv FROM vault WHERE user_id = ? OR user_id IS NULL ORDER BY created_at ASC`
    ).all(user.userId);

    const masterSecret = process.env.VAULT_MASTER_SECRET;
    const clientKeyShare = user.clientKeyShare || null;
    const entries = rows.map((row) => {
      let { title, body, meta } = row;

      // Decrypt encrypted entries for export
      if (masterSecret && row.body_encrypted) {
        const decrypted = decryptFromStorage(row, user.userId, masterSecret, clientKeyShare);
        body = decrypted.body;
        if (decrypted.title) title = decrypted.title;
        meta = decrypted.meta ? JSON.stringify(decrypted.meta) : row.meta;
      }

      return {
        id: row.id,
        kind: row.kind,
        title,
        body,
        tags: row.tags ? JSON.parse(row.tags) : [],
        source: row.source,
        created_at: row.created_at,
        identity_key: row.identity_key || null,
        expires_at: row.expires_at || null,
        meta: meta ? (typeof meta === "string" ? JSON.parse(meta) : meta) : {},
      };
    });

    return c.json({ entries });
  });

  return api;
}
