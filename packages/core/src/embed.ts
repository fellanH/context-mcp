import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';

const MAX_EMBED_THREADS = Math.max(1, Math.min(2, Math.floor(availableParallelism() / 4)));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null;
let embedAvailable: boolean | null = null;
let loadingPromise: Promise<typeof extractor> | null = null;

async function ensurePipeline(): Promise<typeof extractor> {
  if (embedAvailable === false) return null;
  if (extractor) return extractor;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const { pipeline, env } = await import('@huggingface/transformers');

      const threads = Number(process.env.CONTEXT_VAULT_EMBED_THREADS) || MAX_EMBED_THREADS;
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.numThreads = threads;
      }

      const modelCacheDir = join(homedir(), '.context-mcp', 'models');
      mkdirSync(modelCacheDir, { recursive: true });
      env.cacheDir = modelCacheDir;

      console.error(`[context-vault] Loading embedding model (threads=${threads})...`);
      extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      embedAvailable = true;
      return extractor;
    } catch (e) {
      embedAvailable = false;
      console.error(`[context-vault] Failed to load embedding model: ${(e as Error).message}`);
      console.error(`[context-vault] Semantic search disabled. Full-text search still works.`);
      return null;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

export async function embed(text: string): Promise<Float32Array | null> {
  const ext = await ensurePipeline();
  if (!ext) return null;

  const result = await ext([text], { pooling: 'mean', normalize: true });
  if (!result?.data?.length) {
    extractor = null;
    embedAvailable = null;
    loadingPromise = null;
    throw new Error('Embedding pipeline returned empty result');
  }
  return new Float32Array(result.data);
}

const EMBED_CHUNK_SIZE = 8;

export async function embedBatch(texts: string[]): Promise<(Float32Array | null)[]> {
  if (!texts.length) return [];
  const ext = await ensurePipeline();
  if (!ext) return texts.map(() => null);

  // Process in small chunks with event loop yields to prevent CPU monopolization
  const allResults: (Float32Array | null)[] = [];

  for (let i = 0; i < texts.length; i += EMBED_CHUNK_SIZE) {
    const chunk = texts.slice(i, i + EMBED_CHUNK_SIZE);
    const result = await ext(chunk, { pooling: 'mean', normalize: true });
    if (!result?.data?.length) {
      extractor = null;
      embedAvailable = null;
      loadingPromise = null;
      throw new Error('Embedding pipeline returned empty result');
    }
    const dim = result.data.length / chunk.length;
    if (!Number.isInteger(dim) || dim <= 0) {
      throw new Error(
        `Unexpected embedding dimension: ${result.data.length} / ${chunk.length} = ${dim}`
      );
    }
    for (let j = 0; j < chunk.length; j++) {
      allResults.push(result.data.subarray(j * dim, (j + 1) * dim));
    }
    // Yield to event loop between chunks so the server stays responsive
    if (i + EMBED_CHUNK_SIZE < texts.length) {
      await new Promise<void>(r => setTimeout(r, 0));
    }
  }

  return allResults;
}

export function resetEmbedPipeline(): void {
  extractor = null;
  embedAvailable = null;
  loadingPromise = null;
}

export function isEmbedAvailable(): boolean | null {
  return embedAvailable;
}
