/**
 * stripe.js — Stripe billing integration.
 *
 * Handles:
 *   - Checkout session creation for Pro upgrade
 *   - Webhook processing for subscription events
 *   - Tier enforcement based on subscription status
 *
 * Requires environment variables:
 *   STRIPE_SECRET_KEY      — Stripe API secret key
 *   STRIPE_WEBHOOK_SECRET  — Webhook endpoint signing secret
 *   STRIPE_PRICE_PRO       — Price ID for Pro tier ($9/mo)
 *
 * In development, these can be test mode keys.
 * The Stripe SDK is loaded dynamically to avoid requiring it for local mode.
 */

let stripe = null;

/**
 * Initialize the Stripe client.
 * @returns {import("stripe").default | null}
 */
export async function getStripe() {
  if (stripe) return stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;

  try {
    const Stripe =
      globalThis._stripe_constructor || (await import("stripe")).default;
    stripe = new Stripe(key);
    return stripe;
  } catch {
    return null;
  }
}

/**
 * Create a Stripe Checkout session for upgrading to Pro.
 *
 * @param {object} opts
 * @param {string} opts.userId - Internal user ID
 * @param {string} opts.email - User email
 * @param {string} opts.customerId - Stripe customer ID (if exists)
 * @param {string} opts.successUrl - Redirect URL after success
 * @param {string} opts.cancelUrl - Redirect URL after cancel
 * @returns {Promise<{ url: string, sessionId: string } | null>}
 */
export async function createCheckoutSession({
  userId,
  email,
  customerId,
  successUrl,
  cancelUrl,
}) {
  const s = await getStripe();
  if (!s) return null;

  const priceId = process.env.STRIPE_PRICE_PRO;
  if (!priceId) return null;

  const params = {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url:
      successUrl ||
      process.env.STRIPE_SUCCESS_URL ||
      `https://${process.env.FLY_APP_NAME || "localhost:3000"}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:
      cancelUrl ||
      process.env.STRIPE_CANCEL_URL ||
      `https://${process.env.FLY_APP_NAME || "localhost:3000"}/billing/cancel`,
    metadata: { userId },
  };

  if (customerId) {
    params.customer = customerId;
  } else {
    params.customer_email = email;
  }

  const session = await s.checkout.sessions.create(params);
  return { url: session.url, sessionId: session.id };
}

/**
 * Process a Stripe webhook event.
 * Returns the event type and relevant data for the caller to act on.
 *
 * @param {string} body - Raw request body
 * @param {string} signature - Stripe-Signature header
 * @returns {{ type: string, data: object } | null}
 */
export async function verifyWebhookEvent(body, signature) {
  const s = await getStripe();
  if (!s) return null;

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return null;

  try {
    const event = s.webhooks.constructEvent(body, signature, secret);
    return { id: event.id, type: event.type, data: event.data.object };
  } catch {
    return null;
  }
}

// ─── Tier Mapping ───────────────────────────────────────────────────────────

const TIER_LIMITS = {
  free: {
    maxEntries: 500,
    storageMb: 10,
    requestsPerDay: 200,
    apiKeys: 1,
    exportEnabled: false,
  },
  pro: {
    maxEntries: Infinity,
    storageMb: 1024,
    requestsPerDay: Infinity,
    apiKeys: Infinity,
    exportEnabled: true,
  },
  team: {
    maxEntries: Infinity,
    storageMb: 5120,
    requestsPerDay: Infinity,
    apiKeys: Infinity,
    exportEnabled: true,
  },
};

/**
 * Get the limits for a given tier.
 * @param {string} tier
 */
export function getTierLimits(tier) {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
}

/**
 * Check if a user has exceeded their entry limit.
 * @param {string} tier
 * @param {number} currentCount
 */
export function isOverEntryLimit(tier, currentCount) {
  const limits = getTierLimits(tier);
  return currentCount >= limits.maxEntries;
}
