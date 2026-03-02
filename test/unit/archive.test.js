import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { createTestCtx } from "../helpers/ctx.js";
import { formatFrontmatter } from "@context-vault/core/frontmatter";
import { formatBody } from "@context-vault/core/formatters";
import {
  findArchiveCandidates,
  archiveEntries,
  restoreEntry,
  countArchivedEntries,
  listArchivedEntries,
} from "@context-vault/core/core/archive";
import { indexEntry } from "@context-vault/core/index";
import { DEFAULT_LIFECYCLE } from "@context-vault/core/constants";

function writeMdFile(vaultDir, categoryDir, kindDir, filename, opts) {
  const dir = join(vaultDir, categoryDir, kindDir);
  mkdirSync(dir, { recursive: true });

  const fmFields = { id: opts.id };
  if (opts.identity_key) fmFields.identity_key = opts.identity_key;
  if (opts.expires_at) fmFields.expires_at = opts.expires_at;
  fmFields.tags = opts.tags || [];
  fmFields.source = opts.source || "file";
  fmFields.created = opts.created || new Date().toISOString();

  const mdBody = formatBody(opts.kind, {
    title: opts.title,
    body: opts.body,
    meta: opts.meta,
  });
  const filePath = join(dir, filename);
  writeFileSync(filePath, formatFrontmatter(fmFields) + mdBody);
  return filePath;
}

describe("archive — findArchiveCandidates", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    ctx.config.lifecycle = structuredClone(DEFAULT_LIFECYCLE);
  }, 30000);

  afterAll(() => cleanup());

  it("finds entries with tier=ephemeral older than archiveAfterDays", async () => {
    const oldDate = new Date(Date.now() - 60 * 86400000).toISOString();

    const filePath = writeMdFile(
      ctx.config.vaultDir,
      "events",
      "session",
      "old-ephemeral-01234567.md",
      {
        id: "ARCHIVE_EPHEMERAL_01",
        kind: "session",
        title: "Old ephemeral session",
        body: "This session is 60 days old and should be archived",
        tags: ["test"],
        created: oldDate,
      },
    );

    await indexEntry(ctx, {
      id: "ARCHIVE_EPHEMERAL_01",
      kind: "session",
      category: "event",
      title: "Old ephemeral session",
      body: "This session is 60 days old and should be archived",
      tags: ["test"],
      source: "file",
      filePath,
      createdAt: oldDate,
      tier: "ephemeral",
    });

    const candidates = findArchiveCandidates(ctx);
    const found = candidates.find((c) => c.id === "ARCHIVE_EPHEMERAL_01");
    expect(found).toBeTruthy();
    expect(found.tier).toBe("ephemeral");
  });

  it("skips recent entries", async () => {
    const recentDate = new Date().toISOString();

    const filePath = writeMdFile(
      ctx.config.vaultDir,
      "events",
      "session",
      "recent-ephemeral-01234567.md",
      {
        id: "ARCHIVE_RECENT_01",
        kind: "session",
        title: "Recent ephemeral session",
        body: "This session is fresh and should not be archived",
        tags: ["test"],
        created: recentDate,
      },
    );

    await indexEntry(ctx, {
      id: "ARCHIVE_RECENT_01",
      kind: "session",
      category: "event",
      title: "Recent ephemeral session",
      body: "This session is fresh and should not be archived",
      tags: ["test"],
      source: "file",
      filePath,
      createdAt: recentDate,
      tier: "ephemeral",
    });

    const candidates = findArchiveCandidates(ctx);
    const found = candidates.find((c) => c.id === "ARCHIVE_RECENT_01");
    expect(found).toBeUndefined();
  });

  it("finds event category entries older than 90 days", async () => {
    const oldDate = new Date(Date.now() - 100 * 86400000).toISOString();

    const filePath = writeMdFile(
      ctx.config.vaultDir,
      "events",
      "event",
      "old-event-01234567.md",
      {
        id: "ARCHIVE_EVENT_01",
        kind: "event",
        title: "Old event entry",
        body: "This event is 100 days old and should be archived",
        tags: ["test"],
        created: oldDate,
      },
    );

    await indexEntry(ctx, {
      id: "ARCHIVE_EVENT_01",
      kind: "event",
      category: "event",
      title: "Old event entry",
      body: "This event is 100 days old and should be archived",
      tags: ["test"],
      source: "file",
      filePath,
      createdAt: oldDate,
      tier: "working",
    });

    const candidates = findArchiveCandidates(ctx);
    const found = candidates.find((c) => c.id === "ARCHIVE_EVENT_01");
    expect(found).toBeTruthy();
    expect(found.category).toBe("event");
  });

  it("returns empty when no entries match", async () => {
    const freshCtx = (await createTestCtx()).ctx;
    freshCtx.config.lifecycle = structuredClone(DEFAULT_LIFECYCLE);
    const candidates = findArchiveCandidates(freshCtx);
    expect(candidates).toEqual([]);
    freshCtx.db.close();
  });
});

describe("archive — archiveEntries + restoreEntry", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    ctx.config.lifecycle = { ephemeral: { archiveAfterDays: 30 } };
  }, 30000);

  afterAll(() => cleanup());

  it("moves files to _archive/ and removes from index", async () => {
    const oldDate = new Date(Date.now() - 60 * 86400000).toISOString();

    const filePath = writeMdFile(
      ctx.config.vaultDir,
      "events",
      "session",
      "to-archive-01234567.md",
      {
        id: "ARCHIVE_MOVE_01",
        kind: "session",
        title: "Entry to be archived",
        body: "This will be moved to _archive",
        tags: ["test"],
        created: oldDate,
      },
    );

    await indexEntry(ctx, {
      id: "ARCHIVE_MOVE_01",
      kind: "session",
      category: "event",
      title: "Entry to be archived",
      body: "This will be moved to _archive",
      tags: ["test"],
      source: "file",
      filePath,
      createdAt: oldDate,
      tier: "ephemeral",
    });

    expect(ctx.stmts.getEntryById.get("ARCHIVE_MOVE_01")).toBeTruthy();

    const result = await archiveEntries(ctx);

    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(ctx.stmts.getEntryById.get("ARCHIVE_MOVE_01")).toBeUndefined();
    expect(existsSync(filePath)).toBe(false);

    const archivePath = join(
      ctx.config.vaultDir,
      "_archive",
      "events",
      "session",
      "to-archive-01234567.md",
    );
    expect(existsSync(archivePath)).toBe(true);
  });

  it("countArchivedEntries returns correct count", () => {
    const count = countArchivedEntries(ctx.config.vaultDir);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("listArchivedEntries returns entry metadata", () => {
    const entries = listArchivedEntries(ctx.config.vaultDir);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const entry = entries.find((e) => e.id === "ARCHIVE_MOVE_01");
    expect(entry).toBeTruthy();
  });

  it("restoreEntry moves file back and re-indexes", async () => {
    const result = await restoreEntry(ctx, "ARCHIVE_MOVE_01");

    expect(result.restored).toBe(true);
    expect(result.id).toBe("ARCHIVE_MOVE_01");

    const row = ctx.stmts.getEntryById.get("ARCHIVE_MOVE_01");
    expect(row).toBeTruthy();
    expect(row.kind).toBe("session");

    expect(existsSync(result.filePath)).toBe(true);
  });

  it("restoreEntry returns error for missing entry", async () => {
    const result = await restoreEntry(ctx, "NONEXISTENT_ID");
    expect(result.restored).toBe(false);
    expect(result.reason).toContain("not found");
  });
});

describe("archive — countArchivedEntries edge cases", () => {
  it("returns 0 when no _archive directory exists", async () => {
    const { ctx, cleanup } = await createTestCtx();
    expect(countArchivedEntries(ctx.config.vaultDir)).toBe(0);
    cleanup();
  });
});

describe("DEFAULT_LIFECYCLE", () => {
  it("defines event archiveAfterDays as 90", () => {
    expect(DEFAULT_LIFECYCLE.event.archiveAfterDays).toBe(90);
  });

  it("defines ephemeral archiveAfterDays as 30", () => {
    expect(DEFAULT_LIFECYCLE.ephemeral.archiveAfterDays).toBe(30);
  });
});
