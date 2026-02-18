/**
 * Capture Layer — Public API
 *
 * Writes knowledge entries to vault as .md files.
 * That is its entire job. It does not index, embed, or query.
 *
 * Agent Constraint: Only imports from ../core. Never imports ../index or ../retrieve.
 */

import { unlinkSync } from "node:fs";
import { ulid } from "../core/files.js";
import { writeEntryFile } from "./file-ops.js";

export function writeEntry(ctx, { kind, title, body, meta, tags, source, folder }) {
  if (!kind || typeof kind !== "string") {
    throw new Error("writeEntry: kind is required (non-empty string)");
  }
  if (!body || typeof body !== "string" || !body.trim()) {
    throw new Error("writeEntry: body is required (non-empty string)");
  }
  if (tags != null && !Array.isArray(tags)) {
    throw new Error("writeEntry: tags must be an array if provided");
  }
  if (meta != null && typeof meta !== "object") {
    throw new Error("writeEntry: meta must be an object if provided");
  }

  const id = ulid();
  const createdAt = new Date().toISOString();

  const filePath = writeEntryFile(ctx.config.vaultDir, kind, {
    id, title, body, meta, tags, source, createdAt, folder,
  });

  return { id, filePath, kind, title, body, meta, tags, source, createdAt };
}

export async function captureAndIndex(ctx, data, indexFn) {
  const entry = writeEntry(ctx, data);
  try {
    await indexFn(ctx, entry);
    return entry;
  } catch (err) {
    try { unlinkSync(entry.filePath); } catch {}
    throw new Error(
      `Capture succeeded but indexing failed — file rolled back. ${err.message}`
    );
  }
}
