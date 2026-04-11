/**
 * Local hot-path timings: hybrid search vs list-style queries.
 * Run: npm run benchmark:hotpath -- --db-path ~/.context-mcp/vault.db
 *
 * First hybridSearch includes ONNX/transformers load when embeddings work; second is warm.
 */
import { cpus, homedir } from 'node:os';
import { resolveConfig } from '@context-vault/core/config';
import { initDatabase, prepareStatements, insertVec, deleteVec, insertCtxVec, deleteCtxVec } from '@context-vault/core/db';
import { embed, embedBatch } from '@context-vault/core/embed';
import { hybridSearch } from '@context-vault/core/search';
import type { BaseCtx } from '@context-vault/core/types';

function ms(t0: bigint): string {
  return (Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1);
}

async function main() {
  const config = resolveConfig();
  console.log('Node:', process.version);
  console.log('Platform:', process.platform, process.arch);
  console.log('CPUs:', cpus().length);
  console.log('DB:', config.dbPath);
  console.log('HOME:', homedir());
  console.log('');

  const db = await initDatabase(config.dbPath);
  const stmts = prepareStatements(db);

  const ctx: BaseCtx = {
    db,
    config,
    stmts,
    embed,
    insertVec: (rowid, e) => insertVec(stmts, rowid, e),
    deleteVec: (rowid) => deleteVec(stmts, rowid),
    insertCtxVec: (rowid, e) => insertCtxVec(stmts, rowid, e),
    deleteCtxVec: (rowid) => deleteCtxVec(stmts, rowid),
  };

  const total =
    (db.prepare('SELECT COUNT(*) as c FROM vault').get() as { c: number } | undefined)?.c ?? 0;
  const indexed =
    (db.prepare('SELECT COUNT(*) as c FROM vault WHERE indexed = 1').get() as { c: number } | undefined)
      ?.c ?? 0;
  console.log('Rows: vault total=', total, 'indexed=', indexed);
  console.log('');

  const query = process.env.CV_BENCH_QUERY || 'decision architecture';
  let t = process.hrtime.bigint();
  await hybridSearch(ctx, query, { limit: 20, excludeEvents: true });
  console.log(`hybridSearch (cold-ish): ${ms(t)} ms  query="${query}"`);

  t = process.hrtime.bigint();
  await hybridSearch(ctx, query, { limit: 20, excludeEvents: true });
  console.log(`hybridSearch (warm):      ${ms(t)} ms`);

  t = process.hrtime.bigint();
  db.prepare(`SELECT COUNT(*) as c FROM vault WHERE indexed = 1`).get();
  console.log(`SQL COUNT indexed:        ${ms(t)} ms`);

  t = process.hrtime.bigint();
  db
    .prepare(
      `SELECT id, title FROM vault WHERE indexed = 1 ORDER BY created_at DESC LIMIT 100 OFFSET 0`
    )
    .all();
  console.log(`SQL list page 100:        ${ms(t)} ms`);

  const samples = Array.from({ length: 16 }, (_, i) => `benchmark token string ${i} ${query}`);
  t = process.hrtime.bigint();
  await embedBatch(samples);
  console.log(`embedBatch (16 strings):  ${ms(t)} ms`);

  console.log('');
  console.log('See docs/large-vaults.md and tasks/done/search-hotpath-profile/report.md for interpretation.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
