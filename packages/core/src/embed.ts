import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

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

      const modelCacheDir = join(homedir(), '.context-mcp', 'models');
      mkdirSync(modelCacheDir, { recursive: true });
      env.cacheDir = modelCacheDir;

      console.error('[context-vault] Loading embedding model (first run may download ~22MB)...');
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

export async function embedBatch(texts: string[]): Promise<(Float32Array | null)[]> {
  if (!texts.length) return [];
  const ext = await ensurePipeline();
  if (!ext) return texts.map(() => null);

  const result = await ext(texts, { pooling: 'mean', normalize: true });
  if (!result?.data?.length) {
    extractor = null;
    embedAvailable = null;
    loadingPromise = null;
    throw new Error('Embedding pipeline returned empty result');
  }
  const dim = result.data.length / texts.length;
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error(
      `Unexpected embedding dimension: ${result.data.length} / ${texts.length} = ${dim}`
    );
  }
  return texts.map((_, i) => result.data.subarray(i * dim, (i + 1) * dim));
}

export function resetEmbedPipeline(): void {
  extractor = null;
  embedAvailable = null;
  loadingPromise = null;
}

export function isEmbedAvailable(): boolean | null {
  return embedAvailable;
}
