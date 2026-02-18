/**
 * embed.js — Text embedding via HuggingFace transformers
 */

import { pipeline } from "@huggingface/transformers";

let extractor = null;

async function ensurePipeline() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
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
  const dim = 384;
  return texts.map((_, i) => new Float32Array(result.data.buffer, i * dim * 4, dim));
}

/** P5: Force re-initialization on next embed call. */
export function resetEmbedPipeline() {
  extractor = null;
}
