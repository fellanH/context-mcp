/**
 * r2-backup.js — Automated SQLite backup to Cloudflare R2.
 *
 * Periodically backs up vault.db and meta.db to R2.
 * Prunes backups older than 30 days.
 */

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";

/** Timestamp of last successful backup (exported for health check). */
export let lastBackupTimestamp = null;

function createR2Client(config) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || "context-vault-backups";

  if (!accountId || !accessKeyId || !secretAccessKey) return null;

  return { accountId, accessKeyId, secretAccessKey, bucket };
}

/**
 * Backup both vault.db and meta.db to R2.
 */
export async function backupDatabases(ctx, metaDb, config) {
  const r2Config = getR2Config();
  if (!r2Config) {
    console.warn("[backup] R2 not configured — skipping backup");
    return null;
  }

  const client = createR2Client(r2Config);
  const now = new Date();
  const datePrefix = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const timestamp = now.toISOString().replace(/[:.]/g, "-");

  // WAL checkpoint before reading DB files
  try { ctx.db.pragma("wal_checkpoint(TRUNCATE)"); } catch (e) {
    console.warn(`[backup] vault WAL checkpoint failed: ${e.message}`);
  }
  try { metaDb.pragma("wal_checkpoint(TRUNCATE)"); } catch (e) {
    console.warn(`[backup] meta WAL checkpoint failed: ${e.message}`);
  }

  const vaultDbPath = config.dbPath;
  const metaDbPath = join(config.dataDir, "meta.db");

  const uploads = [
    { key: `backups/${datePrefix}/vault-${timestamp}.db`, path: vaultDbPath },
    { key: `backups/${datePrefix}/meta-${timestamp}.db`, path: metaDbPath },
  ];

  for (const { key, path } of uploads) {
    const buffer = readFileSync(path);
    await client.send(new PutObjectCommand({
      Bucket: r2Config.bucket,
      Key: key,
      Body: buffer,
      ContentType: "application/x-sqlite3",
    }));
  }

  // Prune backups older than 30 days
  await pruneOldBackups(client, r2Config.bucket, 30);

  lastBackupTimestamp = now.toISOString();
  console.log(JSON.stringify({
    level: "info",
    event: "backup_completed",
    timestamp: lastBackupTimestamp,
    files: uploads.map((u) => u.key),
  }));

  return lastBackupTimestamp;
}

/**
 * Restore databases from a specific R2 backup.
 */
export async function restoreFromBackup(bucket, timestamp) {
  const r2Config = getR2Config();
  if (!r2Config) throw new Error("R2 not configured");

  const client = createR2Client(r2Config);
  const datePrefix = timestamp.slice(0, 10);
  const ts = timestamp.replace(/[:.]/g, "-");
  const dataDir = process.env.CONTEXT_MCP_DATA_DIR || join(process.env.HOME, ".context-mcp");

  const files = [
    { key: `backups/${datePrefix}/vault-${ts}.db`, dest: join(dataDir, "vault.db") },
    { key: `backups/${datePrefix}/meta-${ts}.db`, dest: join(dataDir, "meta.db") },
  ];

  for (const { key, dest } of files) {
    const response = await client.send(new GetObjectCommand({
      Bucket: bucket || r2Config.bucket,
      Key: key,
    }));

    const chunks = [];
    for await (const chunk of response.Body) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const restorePath = dest + ".restore";
    writeFileSync(restorePath, buffer);

    // Integrity check on restored file
    const Database = (await import("better-sqlite3")).default;
    const testDb = new Database(restorePath, { readonly: true });
    try {
      const result = testDb.pragma("integrity_check");
      if (result[0]?.integrity_check !== "ok") {
        throw new Error(`Integrity check failed for ${key}`);
      }
    } finally {
      testDb.close();
    }

    // Atomic rename
    renameSync(restorePath, dest);
  }

  console.log(JSON.stringify({
    level: "info",
    event: "restore_completed",
    timestamp,
    files: files.map((f) => f.key),
  }));
}

/**
 * Delete backups older than `days` from R2.
 */
async function pruneOldBackups(client, bucket, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let continuationToken;
  const toDelete = [];

  do {
    const list = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: "backups/",
      ContinuationToken: continuationToken,
    }));

    for (const obj of list.Contents || []) {
      // Extract date from key: backups/YYYY-MM-DD/...
      const dateMatch = obj.Key.match(/^backups\/(\d{4}-\d{2}-\d{2})\//);
      if (dateMatch && dateMatch[1] < cutoffStr) {
        toDelete.push({ Key: obj.Key });
      }
    }

    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);

  if (toDelete.length > 0) {
    // Delete in batches of 1000 (S3 limit)
    for (let i = 0; i < toDelete.length; i += 1000) {
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: toDelete.slice(i, i + 1000) },
      }));
    }
    console.log(JSON.stringify({
      level: "info",
      event: "backup_pruned",
      deleted: toDelete.length,
      cutoff: cutoffStr,
    }));
  }
}

/**
 * Schedule periodic backups. Runs once immediately, then every BACKUP_INTERVAL_HOURS.
 */
export function scheduleBackups(ctx, metaDb, config) {
  const r2Config = getR2Config();
  if (!r2Config) {
    console.warn("[backup] R2 not configured — automated backups disabled");
    return null;
  }

  const hours = parseInt(process.env.BACKUP_INTERVAL_HOURS || "6", 10);
  const intervalMs = hours * 60 * 60 * 1000;

  const runBackup = () => {
    backupDatabases(ctx, metaDb, config).catch((err) => {
      console.error(JSON.stringify({
        level: "error",
        event: "backup_failed",
        error: err.message,
        ts: new Date().toISOString(),
      }));
    });
  };

  // Run once immediately
  runBackup();

  // Schedule recurring
  const timer = setInterval(runBackup, intervalMs);
  timer.unref(); // Don't keep process alive for backups

  console.log(`[backup] Scheduled every ${hours}h to R2 bucket: ${r2Config.bucket}`);
  return timer;
}
