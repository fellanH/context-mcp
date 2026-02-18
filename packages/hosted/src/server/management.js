/**
 * management.js — REST API routes for key management, billing, and user operations.
 *
 * Mounted alongside the MCP endpoint in the Hono app.
 * Exported as a factory function to receive ctx for vault DB access.
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import {
  generateApiKey,
  hashApiKey,
  keyPrefix,
  prepareMetaStatements,
  getMetaDb,
  validateApiKey,
} from "../auth/meta-db.js";
import { createCheckoutSession, verifyWebhookEvent, getStripe, getTierLimits, isOverEntryLimit } from "../billing/stripe.js";
import { writeEntry } from "@context-vault/core/capture";
import { indexEntry } from "@context-vault/core/index";
import { generateDek, clearDekCache } from "../encryption/keys.js";
import { decryptFromStorage } from "../encryption/vault-crypto.js";
import { unlinkSync } from "node:fs";

// ─── Validation Constants ────────────────────────────────────────────────────

const MAX_BODY_LENGTH = 100 * 1024; // 100KB
const MAX_TITLE_LENGTH = 500;
const MAX_KIND_LENGTH = 64;
const MAX_TAG_LENGTH = 100;
const MAX_TAGS_COUNT = 20;
const MAX_META_LENGTH = 10 * 1024; // 10KB
const MAX_SOURCE_LENGTH = 200;
const MAX_IDENTITY_KEY_LENGTH = 200;
const KIND_PATTERN = /^[a-z0-9-]+$/;
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

  // ─── Auth helper for management routes ──────────────────────────────────────

  function requireAuth(c) {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) return null;
    return validateApiKey(header.slice(7));
  }

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

  // ─── User Registration (simplified — no Clerk yet) ─────────────────────────

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

    // Wrap all inserts in a transaction to prevent broken user state
    // (e.g. user created without DEK or API key if a step fails mid-way)
    const registerUser = getMetaDb().transaction(() => {
      stmts.createUser.run(userId, email, name || null, "free");
      if (masterSecret) {
        const { encryptedDek, dekSalt } = generateDek(masterSecret);
        stmts.updateUserDek.run(encryptedDek, dekSalt, userId);
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

    return c.json({
      userId,
      email,
      tier: "free",
      apiKey: {
        id: keyId,
        key: rawKey,
        prefix,
        message: "Save this key — it will not be shown again.",
      },
    }, 201);
  });

  // ─── Billing ───────────────────────────────────────────────────────────────

  api.get("/api/billing/usage", (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const stmts = prepareMetaStatements(getMetaDb());
    const requestsToday = stmts.countUsageToday.get(user.userId, "mcp_request");
    const limits = getTierLimits(user.tier);

    const entryCount = ctx.db.prepare("SELECT COUNT(*) as c FROM vault WHERE user_id = ?").get(user.userId).c;
    const storageBytes = ctx.db.prepare(
      "SELECT COALESCE(SUM(LENGTH(COALESCE(body,'')) + LENGTH(COALESCE(body_encrypted,'')) + LENGTH(COALESCE(title,'')) + LENGTH(COALESCE(meta,''))), 0) as s FROM vault WHERE user_id = ?"
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
        }
        break;
      }
      case "customer.subscription.deleted": {
        const customerId = event.data.customer;
        if (customerId) {
          const user = stmts.getUserByStripeCustomerId.get(customerId);
          if (user) stmts.updateUserTier.run("free", user.id);
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

    // 2. Delete vault entries (files + DB + vectors)
    const entries = ctx.db.prepare("SELECT id, file_path FROM vault WHERE user_id = ?").all(user.userId);
    for (const entry of entries) {
      if (entry.file_path) try { unlinkSync(entry.file_path); } catch {}
      try { ctx.deleteVec(entry.id); } catch {}
    }
    ctx.db.prepare("DELETE FROM vault WHERE user_id = ?").run(user.userId);

    // 3. Delete meta records in transaction
    const stmts = prepareMetaStatements(getMetaDb());
    const deleteMeta = getMetaDb().transaction(() => {
      stmts.deleteUserKeys.run(user.userId);
      stmts.deleteUserUsage.run(user.userId);
      stmts.deleteUser.run(user.userId);
    });
    deleteMeta();

    // 4. Clear DEK cache
    clearDekCache(user.userId);

    return c.json({ deleted: true });
  });

  // ─── Vault Import/Export (for migration) ───────────────────────────────────

  /** Import a single entry into the vault */
  api.post("/api/vault/import", async (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const data = await c.req.json().catch(() => null);
    if (!data) return c.json({ error: "Invalid JSON body" }, 400);
    if (!data.body) return c.json({ error: "body is required" }, 400);
    if (!data.kind) return c.json({ error: "kind is required" }, 400);

    // ── Input validation ──────────────────────────────────────────────────
    if (typeof data.kind !== "string" || data.kind.length > MAX_KIND_LENGTH || !KIND_PATTERN.test(data.kind)) {
      return c.json({ error: `kind must be lowercase alphanumeric/hyphens, max ${MAX_KIND_LENGTH} chars` }, 400);
    }
    if (typeof data.body !== "string" || data.body.length > MAX_BODY_LENGTH) {
      return c.json({ error: `body must be a string, max ${MAX_BODY_LENGTH / 1024}KB` }, 400);
    }
    if (data.title !== undefined && data.title !== null) {
      if (typeof data.title !== "string" || data.title.length > MAX_TITLE_LENGTH) {
        return c.json({ error: `title must be a string, max ${MAX_TITLE_LENGTH} chars` }, 400);
      }
    }
    if (data.tags !== undefined && data.tags !== null) {
      if (!Array.isArray(data.tags)) {
        return c.json({ error: "tags must be an array of strings" }, 400);
      }
      if (data.tags.length > MAX_TAGS_COUNT) {
        return c.json({ error: `tags: max ${MAX_TAGS_COUNT} tags allowed` }, 400);
      }
      for (const tag of data.tags) {
        if (typeof tag !== "string" || tag.length > MAX_TAG_LENGTH) {
          return c.json({ error: `each tag must be a string, max ${MAX_TAG_LENGTH} chars` }, 400);
        }
      }
    }
    if (data.meta !== undefined && data.meta !== null) {
      const metaStr = JSON.stringify(data.meta);
      if (metaStr.length > MAX_META_LENGTH) {
        return c.json({ error: `meta must be under ${MAX_META_LENGTH / 1024}KB when serialized` }, 400);
      }
    }
    if (data.source !== undefined && data.source !== null) {
      if (typeof data.source !== "string" || data.source.length > MAX_SOURCE_LENGTH) {
        return c.json({ error: `source must be a string, max ${MAX_SOURCE_LENGTH} chars` }, 400);
      }
    }
    if (data.identity_key !== undefined && data.identity_key !== null) {
      if (typeof data.identity_key !== "string" || data.identity_key.length > MAX_IDENTITY_KEY_LENGTH) {
        return c.json({ error: `identity_key must be a string, max ${MAX_IDENTITY_KEY_LENGTH} chars` }, 400);
      }
    }

    // ── Entry limit enforcement (per-user) ─────────────────────────────────
    const { c: entryCount } = ctx.db.prepare("SELECT COUNT(*) as c FROM vault WHERE user_id = ?").get(user.userId);
    if (isOverEntryLimit(user.tier, entryCount)) {
      return c.json({ error: "Entry limit reached. Upgrade to Pro." }, 403);
    }

    const entry = writeEntry(ctx, {
      kind: data.kind,
      title: data.title,
      body: data.body,
      meta: data.meta,
      tags: data.tags,
      source: data.source,
      identity_key: data.identity_key,
      expires_at: data.expires_at,
      userId: user.userId,
    });

    await indexEntry(ctx, entry);

    return c.json({ id: entry.id });
  });

  /** Export all vault entries */
  api.get("/api/vault/export", (c) => {
    const user = requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const limits = getTierLimits(user.tier);
    if (!limits.exportEnabled) {
      return c.json({ error: "Export is not available on the free tier. Upgrade to Pro." }, 403);
    }

    const rows = ctx.db.prepare(
      `SELECT id, kind, title, body, tags, source, created_at, identity_key, expires_at, meta, body_encrypted, title_encrypted, meta_encrypted, iv FROM vault WHERE user_id = ? ORDER BY created_at ASC`
    ).all(user.userId);

    const masterSecret = process.env.VAULT_MASTER_SECRET;
    const entries = rows.map((row) => {
      let { title, body, meta } = row;

      // Decrypt encrypted entries for export
      if (masterSecret && row.body_encrypted) {
        const decrypted = decryptFromStorage(row, user.userId, masterSecret);
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
