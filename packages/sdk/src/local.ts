import type { VaultBackend, SaveOptions, SaveResult, SearchOptions, SearchResultEntry, HealthResult } from './types.js';

export interface LocalOptions {
  dir?: string;
}

type CoreModules = {
  resolveConfig: () => any;
  initDatabase: (dbPath: string) => Promise<any>;
  prepareStatements: (db: any) => any;
  embed: (text: string) => Promise<Float32Array | null>;
  hybridSearch: (ctx: any, query: string, opts?: any) => Promise<any[]>;
  computeFreshnessScore: (entry: any) => { score: number; label: string };
  captureAndIndex: (ctx: any, data: any) => Promise<any>;
};

let _coreModules: CoreModules | null = null;

async function loadCore(): Promise<CoreModules> {
  if (_coreModules) return _coreModules;

  const [configMod, dbMod, embedMod, searchMod, captureMod] = await Promise.all([
    import('@context-vault/core/config'),
    import('@context-vault/core/db'),
    import('@context-vault/core/embed'),
    import('@context-vault/core/search'),
    import('@context-vault/core/capture'),
  ]).catch((err) => {
    throw new Error(
      `@context-vault/core is required for local mode. Install it: npm install @context-vault/core\n` +
      `Original error: ${(err as Error).message}`
    );
  });

  const modules: CoreModules = {
    resolveConfig: configMod.resolveConfig,
    initDatabase: dbMod.initDatabase,
    prepareStatements: dbMod.prepareStatements,
    embed: embedMod.embed,
    hybridSearch: searchMod.hybridSearch,
    computeFreshnessScore: searchMod.computeFreshnessScore,
    captureAndIndex: captureMod.captureAndIndex,
  };

  _coreModules = modules;
  return modules;
}

export class LocalBackend implements VaultBackend {
  private readonly dir: string | undefined;
  private ctx: any = null;

  constructor(opts?: LocalOptions) {
    this.dir = opts?.dir;
  }

  private async getCtx(): Promise<any> {
    if (this.ctx) return this.ctx;

    const core = await loadCore();

    if (this.dir) {
      process.env.CONTEXT_VAULT_DATA_DIR = this.dir;
    }

    const config = core.resolveConfig();
    const db = await core.initDatabase(config.dbPath);
    const stmts = core.prepareStatements(db);

    const insertVec = db.prepare(
      'INSERT INTO vault_vec (rowid, embedding) VALUES (?, ?)'
    );
    const deleteVec = db.prepare('DELETE FROM vault_vec WHERE rowid = ?');

    let insertCtxVec: any;
    let deleteCtxVec: any;
    try {
      insertCtxVec = db.prepare('INSERT INTO vault_ctx_vec (rowid, embedding) VALUES (?, ?)');
      deleteCtxVec = db.prepare('DELETE FROM vault_ctx_vec WHERE rowid = ?');
    } catch {
      insertCtxVec = { run: () => {} };
      deleteCtxVec = { run: () => {} };
    }

    this.ctx = {
      db,
      config,
      stmts,
      embed: core.embed,
      insertVec: (rowid: number, embedding: Float32Array) => insertVec.run(rowid, embedding),
      deleteVec: (rowid: number) => deleteVec.run(rowid),
      insertCtxVec: (rowid: number, embedding: Float32Array) => insertCtxVec.run(rowid, embedding),
      deleteCtxVec: (rowid: number) => deleteCtxVec.run(rowid),
    };

    return this.ctx;
  }

  async save(options: SaveOptions): Promise<SaveResult> {
    const core = await loadCore();
    const ctx = await this.getCtx();

    const result = await core.captureAndIndex(ctx, {
      kind: options.kind,
      title: options.title,
      body: options.body,
      tags: options.tags || null,
      tier: options.tier || null,
      identity_key: options.identityKey || null,
      source: options.source || null,
      meta: options.meta || null,
    });

    const freshness = core.computeFreshnessScore({
      created_at: result.createdAt,
      updated_at: result.updatedAt,
      last_accessed_at: null,
      last_recalled_at: null,
      recall_count: 0,
      recall_sessions: 0,
      hit_count: 0,
      kind: result.kind,
    });

    return {
      id: result.id,
      freshness: { score: freshness.score, label: freshness.label },
    };
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResultEntry[]> {
    const core = await loadCore();
    const ctx = await this.getCtx();

    const tags = options?.tags ? [...options.tags] : [];
    if (options?.scope) tags.push(`bucket:${options.scope}`);

    const searchOpts: Record<string, unknown> = {
      limit: options?.limit || 20,
    };
    if (options?.kind) searchOpts.kindFilter = options.kind;

    const results = await core.hybridSearch(ctx, query, searchOpts);

    return results.map((r: any) => {
      const entryTags: string[] = r.tags ? JSON.parse(r.tags) : [];

      if (tags.length) {
        const hasAll = tags.every((t: string) => entryTags.includes(t));
        if (!hasAll) return null;
      }

      const freshness = r.freshness_score != null
        ? { score: r.freshness_score as number, label: (r.freshness_label || 'dormant') as string }
        : core.computeFreshnessScore(r);

      return {
        id: r.id as string,
        kind: r.kind as string,
        title: (r.title || '') as string,
        body: r.body as string,
        tags: entryTags,
        score: r.score as number,
        freshness: { score: freshness.score, label: freshness.label },
      };
    }).filter(Boolean) as SearchResultEntry[];
  }

  async health(): Promise<HealthResult> {
    const core = await loadCore();
    const ctx = await this.getCtx();
    const db = ctx.db;

    const totalRow = db.prepare('SELECT COUNT(*) as total FROM vault').get() as { total: number };
    const total = totalRow.total;

    const entries = db.prepare(
      'SELECT id, kind, created_at, updated_at, last_accessed_at, last_recalled_at, recall_count, recall_sessions, hit_count FROM vault WHERE indexed = 1'
    ).all() as any[];

    const distribution: Record<string, number> = { fresh: 0, aging: 0, stale: 0, dormant: 0 };
    const byKind: Record<string, { total: number; sumScore: number }> = {};
    let sumScore = 0;
    let needsAttention = 0;

    for (const entry of entries) {
      const { score, label } = core.computeFreshnessScore(entry);
      distribution[label] = (distribution[label] || 0) + 1;
      sumScore += score;

      if (score < 25) needsAttention++;

      if (!byKind[entry.kind]) byKind[entry.kind] = { total: 0, sumScore: 0 };
      byKind[entry.kind].total++;
      byKind[entry.kind].sumScore += score;
    }

    const byKindResult: Record<string, { total: number; avgScore: number }> = {};
    for (const [kind, data] of Object.entries(byKind)) {
      byKindResult[kind] = {
        total: data.total,
        avgScore: data.total > 0 ? Math.round(data.sumScore / data.total) : 0,
      };
    }

    return {
      total,
      distribution: {
        fresh: distribution.fresh || 0,
        aging: distribution.aging || 0,
        stale: distribution.stale || 0,
        dormant: distribution.dormant || 0,
      },
      averageScore: entries.length > 0 ? Math.round(sumScore / entries.length) : 0,
      needsAttention,
      byKind: byKindResult,
    };
  }

  async delete(id: string): Promise<void> {
    const ctx = await this.getCtx();

    const entry = ctx.stmts.getEntryById.get(id) as { file_path: string | null } | undefined;
    if (!entry) throw new Error(`Entry not found: ${id}`);

    const rowidResult = ctx.stmts.getRowid.get(id) as { rowid: number } | undefined;
    if (rowidResult?.rowid) {
      try { ctx.deleteVec(rowidResult.rowid); } catch {}
    }

    ctx.stmts.deleteEntry.run(id);

    if (entry.file_path) {
      try {
        const { unlinkSync } = await import('node:fs');
        unlinkSync(entry.file_path);
      } catch {}
    }
  }
}
