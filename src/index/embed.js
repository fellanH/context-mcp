/**
 * embed.js — Text embedding via HuggingFace transformers
 */

import { pipeline } from "@huggingface/transformers";

let extractor = null;

async function ensurePipeline() {
  if (!extractor) {
    try {
      console.error("[context-mcp] Loading embedding model (first run may download ~22MB)...");
      extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    } catch (e) {
      console.error(`[context-mcp] Failed to load embedding model: ${e.message}`);
      console.error(`[context-mcp] The model (~22MB) is downloaded on first run.`);
      console.error(`[context-mcp] Check: network connectivity, disk space, Node.js >=20`);
      throw e;
    }
  }
  return extractor;
}

export async function embed(text) {
  const ext = await ensurePipeline();
  const result = await ext([text], { pooling: "mean", normalize: true });
  // P5: Health check — force re-init on empty results
  if (!result?.data?.length) {
    extractor = null;
    throw new Error("Embedding pipeline returned empty result");
  }
  return new Float32Array(result.data);
}

/**
 * P4: Batch embedding — embed multiple texts in a single pipeline call.
 * Returns an array of Float32Array embeddings (one per input text).
 */
export async function embedBatch(texts) {
  if (!texts.length) return [];
  const ext = await ensurePipeline();
  const result = await ext(texts, { pooling: "mean", normalize: true });
  if (!result?.data?.length) {
    extractor = null;
    throw new Error("Embedding pipeline returned empty result");
  }
  const dim = result.data.length / texts.length;
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error(`Unexpected embedding dimension: ${result.data.length} / ${texts.length} = ${dim}`);
  }
  return texts.map((_, i) => new Float32Array(result.data.buffer, i * dim * 4, dim));
}

/** P5: Force re-initialization on next embed call. */
export function resetEmbedPipeline() {
  extractor = null;
}
