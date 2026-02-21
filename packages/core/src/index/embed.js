/**
 * embed.js — Text embedding via HuggingFace transformers
 *
 * Graceful degradation: if the embedding model fails to load (offline, first run,
 * disk issues), semantic search is disabled but FTS still works.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

let extractor = null;

/** @type {null | true | false} null = unknown, true = working, false = failed */
let embedAvailable = null;

/** Shared promise for in-flight initialization — prevents concurrent loads */
let loadingPromise = null;

async function ensurePipeline() {
  if (embedAvailable === false) return null;
  if (extractor) return extractor;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      // Dynamic import — @huggingface/transformers is optional (its transitive
      // dep `sharp` can fail to install on some platforms).  When missing, the
      // server still works with full-text search only.
      const { pipeline, env } = await import("@huggingface/transformers");

      // Redirect model cache to ~/.context-mcp/models/ so it works when the
      // package is installed globally in a root-owned directory (e.g. /usr/lib/node_modules/).
      const modelCacheDir = join(homedir(), ".context-mcp", "models");
      mkdirSync(modelCacheDir, { recursive: true });
      env.cacheDir = modelCacheDir;

      console.error(
        "[context-vault] Loading embedding model (first run may download ~22MB)...",
      );
      extractor = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
      );
      embedAvailable = true;
      return extractor;
    } catch (e) {
      embedAvailable = false;
      console.error(
        `[context-vault] Failed to load embedding model: ${e.message}`,
      );
      console.error(
        `[context-vault] Semantic search disabled. Full-text search still works.`,
      );
      return null;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

export async function embed(text) {
  const ext = await ensurePipeline();
  if (!ext) return null;

  const result = await ext([text], { pooling: "mean", normalize: true });
  // Health check — force re-init on empty results
  if (!result?.data?.length) {
    extractor = null;
    embedAvailable = null;
    loadingPromise = null;
    throw new Error("Embedding pipeline returned empty result");
  }
  return new Float32Array(result.data);
}

/**
 * Batch embedding — embed multiple texts in a single pipeline call.
 * Returns an array of Float32Array embeddings (one per input text).
 * Returns array of nulls if embedding is unavailable.
 */
export async function embedBatch(texts) {
  if (!texts.length) return [];
  const ext = await ensurePipeline();
  if (!ext) return texts.map(() => null);

  const result = await ext(texts, { pooling: "mean", normalize: true });
  if (!result?.data?.length) {
    extractor = null;
    embedAvailable = null;
    loadingPromise = null;
    throw new Error("Embedding pipeline returned empty result");
  }
  const dim = result.data.length / texts.length;
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error(
      `Unexpected embedding dimension: ${result.data.length} / ${texts.length} = ${dim}`,
    );
  }
  return texts.map(
    (_, i) => new Float32Array(result.data.buffer, i * dim * 4, dim),
  );
}

/** Force re-initialization on next embed call. */
export function resetEmbedPipeline() {
  extractor = null;
  embedAvailable = null;
  loadingPromise = null;
}

/** Check if embedding is currently available. */
export function isEmbedAvailable() {
  return embedAvailable;
}
