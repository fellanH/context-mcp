/**
 * user-ctx.js — Build per-user vault context from shared server context.
 *
 * Extracted from createMcpServer() so both MCP and REST endpoints share
 * the same user context construction logic.
 */

import { encryptForStorage, decryptFromStorage } from "../encryption/vault-crypto.js";
import { getTierLimits } from "../billing/stripe.js";

/**
 * Build a per-user context from the shared server context.
 *
 * @param {object} ctx — Shared server context (db, config, stmts, embed, insertVec, deleteVec)
 * @param {{ userId?: string, tier?: string } | null} user — Authenticated user info (null for dev mode)
 * @param {string | null} masterSecret — VAULT_MASTER_SECRET env var
 * @param {{ teamId?: string } | null} teamScope — Optional team scoping context
 * @returns {object} User-scoped context with encrypt/decrypt/checkLimits
 */
export function buildUserCtx(ctx, user, masterSecret, teamScope) {
  const userId = user?.userId || null;
  const userCtx = userId ? { ...ctx, userId } : ctx;

  // Attach team context when operating in team scope
  if (teamScope?.teamId) {
    userCtx.teamId = teamScope.teamId;
  }

  // Add encryption/decryption when master secret is configured and user is authenticated
  if (masterSecret && userId) {
    userCtx.encrypt = (entry) => encryptForStorage(entry, userId, masterSecret);
    userCtx.decrypt = (row) => decryptFromStorage(row, userId, masterSecret);
  }

  // Attach tier limits for hosted mode
  if (userId && user.tier) {
    const limits = getTierLimits(user.tier);
    userCtx.checkLimits = () => {
      const entryCount = ctx.db.prepare("SELECT COUNT(*) as c FROM vault WHERE user_id = ?").get(userId).c;
      const storageBytes = ctx.db.prepare(
        "SELECT COALESCE(SUM(LENGTH(COALESCE(body,'')) + LENGTH(COALESCE(body_encrypted,'')) + LENGTH(COALESCE(title,'')) + LENGTH(COALESCE(meta,''))), 0) as s FROM vault WHERE user_id = ?"
      ).get(userId).s;
      return {
        entryCount,
        storageMb: storageBytes / (1024 * 1024),
        maxEntries: limits.maxEntries,
        maxStorageMb: limits.storageMb,
      };
    };
  }

  return userCtx;
}
