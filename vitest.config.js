import { defineConfig } from 'vitest/config';
import { transformWithEsbuild } from 'vite';

// packages/local/src ships TypeScript source with .js extensions.
// Detect files that have TypeScript-specific syntax and strip it via esbuild.
const TS_SYNTAX_RE =
  /(?:^|\n)(?:import type\b|export type\b)|:\s*(?:string|number|boolean|Date|void|unknown|never|null|undefined|Record|Array)\b|\)\s*:\s*\w|\bas\s+\w|<[A-Z]\w*>/;

const localSrcTsPlugin = {
  name: 'local-src-ts-as-js',
  async transform(code, id) {
    if (id.includes('/packages/local/src/') && id.endsWith('.js') && TS_SYNTAX_RE.test(code)) {
      const result = await transformWithEsbuild(code, id, { loader: 'ts' });
      return result;
    }
  },
};

export default defineConfig({
  plugins: [localSrcTsPlugin],
  test: {
    testTimeout: 30000,
  },
});
