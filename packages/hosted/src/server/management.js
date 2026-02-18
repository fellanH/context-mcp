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
import { createCheckoutSession, verifyWebhookEvent, getTierLimits } from "../billing/stripe.js";
import { writeEntry } from "@context-vault/core/capture";
import { indexEntry } from "@context-vault/core/index";

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

    const body = await c.req.json().catch(() => ({}));
    const name = body.name || "default";

    const rawKey = generateApiKey();
    const hash = hashApiKey(rawKey);
    const prefix = keyPrefix(rawKey);
    const id = randomUUID();

    const stmts = prepareMetaStatements(getMetaDb());
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
    const body = await c.req.json().catch(() => ({}));
    const { email, name } = body;
    if (!email) return c.json({ error: "email is required" }, 400);

    const stmts = prepareMetaStatements(getMetaDb());

    // Check if already exists
    const existing = stmts.getUserByEmail.get(email);
    if (existing) return c.json({ error: "User already exists" }, 409);

    const userId = randomUUID();
    stmts.createUser.run(userId, email, name || null, "free");

    // Generate first API key
    const rawKey = generateApiKey();
    const hash = hashApiKey(rawKey);
    const prefix = keyPrefix(rawKey);
    const keyId = randomUUID();
    stmts.createApiKey.run(keyId, userId, hash, prefix, "default");

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
    }

    return c.json({ received: true });
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

    const entry = writeEntry(ctx, {
      kind: data.kind,
      title: data.title,
      body: data.body,
      meta: data.meta,
      tags: data.tags,
      source: data.source,
      identity_key: data.identity_key,
      expires_at: data.expires_at,
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
      `SELECT id, kind, title, body, tags, source, created_at, identity_key, expires_at, meta FROM vault ORDER BY created_at ASC`
    ).all();

    const entries = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      tags: row.tags ? JSON.parse(row.tags) : [],
      source: row.source,
      created_at: row.created_at,
      identity_key: row.identity_key || null,
      expires_at: row.expires_at || null,
      meta: row.meta ? JSON.parse(row.meta) : {},
    }));

    return c.json({ entries });
  });

  return api;
}
