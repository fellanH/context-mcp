import { z } from "zod";
import { captureAndIndex } from "../../capture/index.js";
import { indexEntry } from "../../index/index.js";
import { ok, err, ensureVaultExists } from "../helpers.js";

// ─── Input size limits (mirrors hosted validation) ────────────────────────────
const MAX_URL_LENGTH = 2048;
const MAX_KIND_LENGTH = 64;
const MAX_TAG_LENGTH = 100;
const MAX_TAGS_COUNT = 20;

export const name = "ingest_url";

export const description =
  "Fetch a URL, extract its readable content, and save it as a vault entry. Useful for saving articles, documentation, or web pages to your knowledge vault.";

export const inputSchema = {
  url: z.string().describe("The URL to fetch and save"),
  kind: z.string().optional().describe("Entry kind (default: reference)"),
  tags: z.array(z.string()).optional().describe("Tags for the entry"),
};

export async function handler({ url: targetUrl, kind, tags }, ctx, { ensureIndexed }) {
  const { config } = ctx;
  const userId = ctx.userId !== undefined ? ctx.userId : undefined;

  const vaultErr = ensureVaultExists(config);
  if (vaultErr) return vaultErr;

  if (!targetUrl?.trim()) return err("Required: url (non-empty string)", "INVALID_INPUT");
  if (targetUrl.length > MAX_URL_LENGTH) return err(`url must be under ${MAX_URL_LENGTH} chars`, "INVALID_INPUT");
  if (kind !== undefined && kind !== null) {
    if (typeof kind !== "string" || kind.length > MAX_KIND_LENGTH) {
      return err(`kind must be a string, max ${MAX_KIND_LENGTH} chars`, "INVALID_INPUT");
    }
  }
  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags)) return err("tags must be an array of strings", "INVALID_INPUT");
    if (tags.length > MAX_TAGS_COUNT) return err(`tags: max ${MAX_TAGS_COUNT} tags allowed`, "INVALID_INPUT");
    for (const tag of tags) {
      if (typeof tag !== "string" || tag.length > MAX_TAG_LENGTH) {
        return err(`each tag must be a string, max ${MAX_TAG_LENGTH} chars`, "INVALID_INPUT");
      }
    }
  }

  await ensureIndexed();

  // Hosted tier limit enforcement
  if (ctx.checkLimits) {
    const usage = ctx.checkLimits();
    if (usage.entryCount >= usage.maxEntries) {
      return err(`Entry limit reached (${usage.maxEntries}). Upgrade to Pro for unlimited entries.`, "LIMIT_EXCEEDED");
    }
  }

  try {
    const { ingestUrl } = await import("../../capture/ingest-url.js");
    const entryData = await ingestUrl(targetUrl, { kind, tags });
    const entry = await captureAndIndex(ctx, { ...entryData, userId }, indexEntry);
    const relPath = entry.filePath ? entry.filePath.replace(config.vaultDir + "/", "") : entry.filePath;
    const parts = [
      `✓ Ingested URL → ${relPath}`,
      `  id: ${entry.id}`,
      `  title: ${entry.title || "(untitled)"}`,
      `  source: ${entry.source || targetUrl}`,
    ];
    if (entry.tags?.length) parts.push(`  tags: ${entry.tags.join(", ")}`);
    parts.push(`  body: ${entry.body?.length || 0} chars`);
    parts.push("", "_Use this id to update or delete later._");
    return ok(parts.join("\n"));
  } catch (e) {
    return err(`Failed to ingest URL: ${e.message}`, "INGEST_FAILED");
  }
}
