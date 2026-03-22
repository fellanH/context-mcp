import type { IndexingConfig } from './types.js';
import { DEFAULT_INDEXING } from './constants.js';

export function shouldIndex(
  opts: {
    kind: string;
    category: string;
    bodyLength: number;
    explicitIndexed?: boolean;
  },
  config?: IndexingConfig | null
): boolean {
  if (opts.explicitIndexed === true) return true;
  if (opts.explicitIndexed === false) return false;

  const c = config ?? DEFAULT_INDEXING;

  if (c.excludeKinds.length > 0 && c.excludeKinds.includes(opts.kind)) {
    return false;
  }

  if (c.excludeCategories.length > 0 && c.excludeCategories.includes(opts.category)) {
    return false;
  }

  if (opts.category === 'event' && !c.autoIndexEvents) {
    return false;
  }

  if (c.maxBodySize > 0 && opts.bodyLength > c.maxBodySize) {
    return false;
  }

  return true;
}
