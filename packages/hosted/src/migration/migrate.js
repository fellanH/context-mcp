/**
 * migrate.js — Bidirectional migration between local and hosted vaults.
 *
 * Commands:
 *   context-vault migrate --to-hosted   Upload local vault to hosted
 *   context-vault migrate --to-local    Download hosted vault to local files
 *
 * Flow (--to-hosted):
 *   1. Read all .md files from local vault
 *   2. POST each to /api/vault/import with API key auth
 *   3. Server encrypts and indexes each entry
 *   4. Local vault stays intact as read-only backup
 *
 * Flow (--to-local):
 *   1. GET /api/vault/export with API key auth
 *   2. Server decrypts and returns all entries
 *   3. Write each as .md file to local vault directory
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { walkDir } from "@context-vault/core/core/files";
import {
  parseFrontmatter,
  formatFrontmatter,
} from "@context-vault/core/core/frontmatter";
import { kindToPath } from "@context-vault/core/core/files";
import { formatBody } from "@context-vault/core/capture/formatters";

/**
 * Migrate local vault entries to hosted.
 *
 * @param {object} opts
 * @param {string} opts.vaultDir - Local vault directory
 * @param {string} opts.hostedUrl - Hosted server URL
 * @param {string} opts.apiKey - API key for auth
 * @param {(msg: string) => void} [opts.log] - Logger function
 * @returns {Promise<{ uploaded: number, failed: number, errors: string[] }>}
 */
export async function migrateToHosted({
  vaultDir,
  hostedUrl,
  apiKey,
  log = console.log,
}) {
  const baseUrl = hostedUrl.replace(/\/$/, "");
  const results = { uploaded: 0, failed: 0, errors: [] };

  // Discover all markdown files
  if (!existsSync(vaultDir)) {
    throw new Error(`Vault directory not found: ${vaultDir}`);
  }

  const files = walkDir(vaultDir);
  log(`Found ${files.length} entries to migrate`);

  for (const { filePath } of files) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const { meta, body } = parseFrontmatter(raw);

      const res = await fetch(`${baseUrl}/api/vault/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          id: meta.id,
          kind: meta.kind || guessKindFromPath(filePath, vaultDir),
          title: meta.title || null,
          body,
          tags: meta.tags || [],
          source: meta.source || "migration",
          identity_key: meta.identity_key || null,
          expires_at: meta.expires_at || null,
          created_at: meta.created || null,
          meta: extractCustomMeta(meta),
        }),
      });

      if (res.ok) {
        results.uploaded++;
      } else {
        const err = await res.text();
        results.failed++;
        results.errors.push(`${filePath}: ${err}`);
      }
    } catch (e) {
      results.failed++;
      results.errors.push(`${filePath}: ${e.message}`);
    }
  }

  return results;
}

/**
 * Migrate hosted vault entries to local .md files.
 *
 * @param {object} opts
 * @param {string} opts.vaultDir - Target local vault directory
 * @param {string} opts.hostedUrl - Hosted server URL
 * @param {string} opts.apiKey - API key for auth
 * @param {(msg: string) => void} [opts.log] - Logger function
 * @returns {Promise<{ downloaded: number, failed: number, errors: string[] }>}
 */
export async function migrateToLocal({
  vaultDir,
  hostedUrl,
  apiKey,
  log = console.log,
}) {
  const baseUrl = hostedUrl.replace(/\/$/, "");
  const results = { downloaded: 0, failed: 0, errors: [] };

  const res = await fetch(`${baseUrl}/api/vault/export`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Export failed: ${res.status} ${await res.text()}`);
  }

  const { entries } = await res.json();
  log(`Received ${entries.length} entries to restore`);

  for (const entry of entries) {
    try {
      const kind = entry.kind || "insight";
      const dir = resolve(vaultDir, kindToPath(kind));
      mkdirSync(dir, { recursive: true });

      // Build frontmatter
      const fm = { id: entry.id };
      if (entry.identity_key) fm.identity_key = entry.identity_key;
      if (entry.expires_at) fm.expires_at = entry.expires_at;
      fm.tags = entry.tags || [];
      fm.source = entry.source || "migration";
      fm.created = entry.created_at || new Date().toISOString();

      // Add custom meta fields
      if (entry.meta && typeof entry.meta === "object") {
        for (const [k, v] of Object.entries(entry.meta)) {
          if (
            ![
              "id",
              "tags",
              "source",
              "created",
              "identity_key",
              "expires_at",
            ].includes(k)
          ) {
            fm[k] = v;
          }
        }
      }

      const mdBody = formatBody(kind, {
        title: entry.title,
        body: entry.body,
        meta: entry.meta,
      });
      const md = formatFrontmatter(fm) + mdBody;

      // Determine filename
      const slug = (entry.title || entry.body || "")
        .slice(0, 40)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const shortId = (entry.id || "").slice(-8).toLowerCase();
      const filename = slug ? `${slug}-${shortId}.md` : `${shortId}.md`;

      writeFileSync(resolve(dir, filename), md);
      results.downloaded++;
    } catch (e) {
      results.failed++;
      results.errors.push(`${entry.id}: ${e.message}`);
    }
  }

  return results;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const RESERVED_FM_KEYS = new Set([
  "id",
  "tags",
  "source",
  "created",
  "identity_key",
  "expires_at",
  "kind",
  "title",
]);

function extractCustomMeta(meta) {
  const custom = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!RESERVED_FM_KEYS.has(k)) custom[k] = v;
  }
  return Object.keys(custom).length ? custom : undefined;
}

function guessKindFromPath(filePath, vaultDir) {
  const rel = filePath.replace(vaultDir + "/", "");
  const parts = rel.split("/");
  // Expected: category/kinds/file.md or kinds/file.md
  if (parts.length >= 2) {
    const dirName = parts[parts.length - 2];
    // Convert plural to singular
    return dirName.replace(/s$/, "");
  }
  return "insight";
}
