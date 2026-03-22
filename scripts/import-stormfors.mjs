#!/usr/bin/env node

/**
 * Import Stormfors Notion data from stormfors.db into the context vault.
 *
 * Usage:
 *   node scripts/import-stormfors.mjs           # full import
 *   node scripts/import-stormfors.mjs --dry-run  # preview without saving
 */

import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const STORMFORS_DB = resolve(homedir(), 'omni/workspaces/stormfors/notion-sync/stormfors.db');
const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Vault context setup (mirrors CLI runSave pattern)
// ---------------------------------------------------------------------------

async function createVaultCtx() {
  const { resolveConfig } = await import('@context-vault/core/config');
  const { initDatabase, prepareStatements, insertVec, deleteVec, insertCtxVec, deleteCtxVec } =
    await import('@context-vault/core/db');
  const { embed } = await import('@context-vault/core/embed');

  const config = resolveConfig();
  if (!config.vaultDirExists) {
    console.error('Error: vault not initialised');
    process.exit(1);
  }
  const db = await initDatabase(config.dbPath);
  const stmts = prepareStatements(db);
  return {
    ctx: {
      db,
      config,
      stmts,
      embed,
      insertVec: (rowid, embedding) => insertVec(stmts, rowid, embedding),
      deleteVec: (rowid) => deleteVec(stmts, rowid),
      insertCtxVec: (rowid, embedding) => insertCtxVec(stmts, rowid, embedding),
      deleteCtxVec: (rowid) => deleteCtxVec(stmts, rowid),
    },
    close: () => { try { db.close(); } catch {} },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function safeJson(val) {
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

function parsePeople(json) {
  const arr = safeJson(json);
  if (!Array.isArray(arr)) return [];
  return arr.filter(p => p && p.email);
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function progressLog(label, current, total) {
  if (current % 50 === 0 || current === total) {
    process.stdout.write(`\r  ${label}: ${current}/${total}`);
    if (current === total) process.stdout.write('\n');
  }
}

// ---------------------------------------------------------------------------
// Entity: Projects
// ---------------------------------------------------------------------------

function buildProjectEntry(row) {
  const tags = ['bucket:stormfors', 'source:notion', 'entity:project', 'stormfors-project'];

  if (row.project_status) {
    tags.push(`status:${slugify(row.project_status)}`);
  }
  if (row.project_type) {
    tags.push(`type:${slugify(row.project_type)}`);
  }
  if (row.client_name) {
    tags.push(`has-client:${slugify(row.client_name)}`);
  }

  const managers = parsePeople(row.project_managers);

  const lines = [];
  if (row.project_status) lines.push(`**Status:** ${row.project_status}`);
  if (row.project_type) lines.push(`**Type:** ${row.project_type}`);
  if (row.client_name) lines.push(`**Client:** ${row.client_name}`);
  if (row.project_start) lines.push(`**Start:** ${row.project_start}`);
  if (row.project_deadline) lines.push(`**Deadline:** ${row.project_deadline}`);
  if (row.project_completed_date) lines.push(`**Completed:** ${row.project_completed_date}`);
  if (managers.length) {
    lines.push(`**Project Managers:** ${managers.map(m => m.name || m.email).join(', ')}`);
  }
  if (row.price_estimate_sek != null) lines.push(`**Price Estimate:** ${row.price_estimate_sek} SEK`);
  if (row.time_estimate_hrs != null) lines.push(`**Time Estimate:** ${row.time_estimate_hrs}h`);
  if (row.project_summary) lines.push(`\n${row.project_summary}`);
  if (row.project_description) lines.push(`\n${row.project_description}`);

  const urls = [];
  if (row.url_markup) urls.push(`- Markup: ${row.url_markup}`);
  if (row.url_staging) urls.push(`- Staging: ${row.url_staging}`);
  if (row.url_sitemap) urls.push(`- Sitemap: ${row.url_sitemap}`);
  if (row.url_client_drive) urls.push(`- Drive: ${row.url_client_drive}`);
  if (row.url_slack_channel) urls.push(`- Slack: ${row.url_slack_channel}`);
  if (row.url_airtable) urls.push(`- Airtable: ${row.url_airtable}`);
  if (row.url_trello) urls.push(`- Trello: ${row.url_trello}`);
  if (urls.length) lines.push(`\n**Links:**\n${urls.join('\n')}`);

  const isActive = ['active', 'ongoing', 'in progress'].includes(
    (row.project_status || '').toLowerCase()
  );

  return {
    kind: 'project',
    title: (row.name || '').trim(),
    body: lines.join('\n') || 'No details available.',
    tags,
    source: 'notion',
    identity_key: `stormfors-project-${row.id}`,
    tier: isActive ? 'durable' : 'working',
    meta: {
      source: 'notion',
      notion_id: row.id,
      client_id: row.client_id || null,
      project_status: row.project_status || null,
      synced_at: row.synced_at,
    },
  };
}

// ---------------------------------------------------------------------------
// Entity: People (contacts)
// ---------------------------------------------------------------------------

function buildContactEntry(email, name, projectNames, timeReportCount) {
  const lines = [];
  lines.push(`**Email:** ${email}`);
  if (projectNames.length) {
    lines.push(`**Projects:** ${projectNames.join(', ')}`);
  }
  if (timeReportCount > 0) {
    lines.push(`**Time entries:** ${timeReportCount}`);
  }

  return {
    kind: 'contact',
    title: name || email,
    body: lines.join('\n'),
    tags: ['bucket:stormfors', 'source:notion', 'entity:contact', 'stormfors-team'],
    source: 'notion',
    identity_key: `stormfors-person-${email}`,
    tier: 'durable',
    meta: { source: 'notion', email },
  };
}

// ---------------------------------------------------------------------------
// Event: Sprints
// ---------------------------------------------------------------------------

function buildSprintEntry(row) {
  const tags = ['bucket:stormfors', 'source:notion', 'event:sprint'];

  if (row.sprint_status) {
    tags.push(`sprint:${slugify(row.sprint_status)}`);
  }
  const dept = safeJson(row.department);
  if (Array.isArray(dept)) {
    dept.forEach(d => { if (d) tags.push(`dept:${slugify(d)}`); });
  }

  const isActive = ['active', 'in progress'].includes(
    (row.sprint_status || '').toLowerCase()
  );

  const lines = [];
  if (row.sprint_status) lines.push(`**Status:** ${row.sprint_status}`);
  if (row.sprint_priority) lines.push(`**Priority:** ${row.sprint_priority}`);
  if (row.timeline_start || row.timeline_end) {
    lines.push(`**Timeline:** ${row.timeline_start || '?'} to ${row.timeline_end || '?'}`);
  }
  if (row.time_est_hrs != null) lines.push(`**Time Estimate:** ${row.time_est_hrs}h`);
  if (row.ai_summary) lines.push(`\n${row.ai_summary}`);
  if (row.project_id) lines.push(`\n**Project ID:** ${row.project_id}`);

  // Use kind 'event' since 'sprint' is not in KIND_CATEGORY
  // (would misplace files under knowledge/ instead of events/)
  return {
    kind: 'event',
    title: (row.name || '').trim() || `Sprint ${row.id.slice(0, 8)}`,
    body: lines.join('\n') || 'No details.',
    tags,
    source: 'notion',
    indexed: false,
    tier: isActive ? 'working' : 'ephemeral',
    meta: {
      source: 'notion',
      notion_id: row.id,
      project_id: row.project_id || null,
      sprint_status: row.sprint_status || null,
      entry_type: 'sprint',
    },
  };
}

// ---------------------------------------------------------------------------
// Event: Tasks
// ---------------------------------------------------------------------------

function buildTaskEntry(row) {
  const tags = ['bucket:stormfors', 'source:notion', 'event:task'];

  if (row.task_status) {
    tags.push(`task:${slugify(row.task_status)}`);
  }
  if (row.task_type) {
    tags.push(`task-type:${slugify(row.task_type)}`);
  }
  if (row.task_priority) {
    tags.push(`priority:${slugify(row.task_priority)}`);
  }
  const platforms = safeJson(row.platform);
  if (Array.isArray(platforms)) {
    platforms.forEach(p => { if (p) tags.push(`platform:${slugify(p)}`); });
  }

  const lines = [];
  if (row.task_status) lines.push(`**Status:** ${row.task_status}`);
  if (row.task_priority) lines.push(`**Priority:** ${row.task_priority}`);
  if (row.task_type) lines.push(`**Type:** ${row.task_type}`);
  if (row.task_scope) lines.push(`**Scope:** ${row.task_scope}`);
  if (row.task_story_points != null) lines.push(`**Story Points:** ${row.task_story_points}`);
  if (row.task_deadline) lines.push(`**Deadline:** ${row.task_deadline}`);
  if (row.time_estimate_hrs != null) lines.push(`**Time Estimate:** ${row.time_estimate_hrs}h`);
  if (row.billed) lines.push(`**Billed:** Yes`);
  if (row.billing_comment) lines.push(`**Billing Comment:** ${row.billing_comment}`);
  if (row.sprint_id) lines.push(`**Sprint ID:** ${row.sprint_id}`);

  return {
    kind: 'task',
    title: (row.name || '').trim() || `Task ${row.id.slice(0, 8)}`,
    body: lines.join('\n') || 'No details.',
    tags,
    source: 'notion',
    indexed: false,
    tier: 'ephemeral',
    meta: {
      source: 'notion',
      notion_id: row.id,
      sprint_id: row.sprint_id || null,
      task_status: row.task_status || null,
      billed: row.billed || 0,
      entry_type: 'task',
    },
  };
}

// ---------------------------------------------------------------------------
// Event: Time reports
// ---------------------------------------------------------------------------

function buildTimeEntry(row) {
  const tags = ['bucket:stormfors', 'source:notion', 'event:time-entry'];

  const summary = (row.work_summary || '').trim();
  const title = summary
    ? truncate(summary, 80)
    : `Time entry: ${row.hours || 0}h`;

  const lines = [];
  if (summary) lines.push(summary);
  if (row.hours != null) lines.push(`**Hours:** ${row.hours}`);

  const creator = safeJson(row.created_by);
  if (creator?.name) lines.push(`**By:** ${creator.name}`);
  if (row.notion_created_time) lines.push(`**Date:** ${row.notion_created_time}`);

  // Use kind 'log' since 'time-entry' is not in KIND_CATEGORY
  return {
    kind: 'log',
    title,
    body: lines.join('\n') || `${row.hours || 0}h logged`,
    tags,
    source: 'notion',
    indexed: false,
    tier: 'ephemeral',
    meta: {
      source: 'notion',
      notion_id: row.id,
      task_id: row.task_id || null,
      hours: row.hours || 0,
      created_by_email: creator?.email || null,
      entry_type: 'time-entry',
    },
  };
}

// ---------------------------------------------------------------------------
// Dedup check for events (entities use identity_key natively)
// ---------------------------------------------------------------------------

function isAlreadyImported(vaultDb, notionId) {
  try {
    const row = vaultDb.prepare(
      "SELECT id FROM vault WHERE json_extract(meta, '$.notion_id') = ?"
    ).get(notionId);
    return !!row;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Stormfors Notion -> Context Vault import`);
  console.log(`Source: ${STORMFORS_DB}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  // Open source DB
  const src = new DatabaseSync(STORMFORS_DB);

  // Load vault context (skip in dry-run to avoid side effects)
  let vaultCtx = null;
  let captureAndIndex = null;
  if (!DRY_RUN) {
    const vault = await createVaultCtx();
    vaultCtx = vault.ctx;
    const mod = await import('@context-vault/core/capture');
    captureAndIndex = mod.captureAndIndex;
  }

  const stats = { projects: 0, contacts: 0, sprints: 0, tasks: 0, timeEntries: 0, skipped: 0 };

  // ------- Projects (entities) -------
  const projects = src.prepare('SELECT * FROM projects').all();
  console.log(`\nProjects: ${projects.length} rows`);
  for (let i = 0; i < projects.length; i++) {
    const entry = buildProjectEntry(projects[i]);
    if (DRY_RUN) {
      if (i < 3) console.log(`  [dry] ${entry.identity_key}: ${entry.title}`);
    } else {
      try {
        await captureAndIndex(vaultCtx, entry);
        stats.projects++;
      } catch (e) {
        console.error(`\n  Error saving project ${entry.title}: ${e.message}`);
      }
    }
    progressLog('Projects', i + 1, projects.length);
  }
  if (DRY_RUN) stats.projects = projects.length;

  // ------- Contacts (entities, extracted from task_owner) -------
  const peopleMap = new Map(); // email -> { name, projects: Set, timeReports: number }

  // From task_owner
  const taskOwners = src.prepare(
    "SELECT DISTINCT task_owner FROM tasks WHERE task_owner IS NOT NULL AND task_owner != '[]'"
  ).all();
  for (const row of taskOwners) {
    const people = parsePeople(row.task_owner);
    for (const p of people) {
      if (!peopleMap.has(p.email)) {
        peopleMap.set(p.email, { name: p.name, projects: new Set(), timeReports: 0 });
      } else if (p.name && !peopleMap.get(p.email).name) {
        peopleMap.get(p.email).name = p.name;
      }
    }
  }

  // Enrich with project associations via tasks -> sprints -> projects
  // (skip for now, just track raw data)

  // From time_reports created_by (all null email in sample, but handle anyway)
  const timeCreators = src.prepare('SELECT DISTINCT created_by FROM time_reports').all();
  for (const row of timeCreators) {
    const creator = safeJson(row.created_by);
    if (creator?.email) {
      if (!peopleMap.has(creator.email)) {
        peopleMap.set(creator.email, { name: creator.name, projects: new Set(), timeReports: 0 });
      }
    }
  }

  // Count time reports per person
  const allTimeReports = src.prepare('SELECT created_by FROM time_reports').all();
  for (const row of allTimeReports) {
    const creator = safeJson(row.created_by);
    if (creator?.email && peopleMap.has(creator.email)) {
      peopleMap.get(creator.email).timeReports++;
    }
  }

  console.log(`\nContacts: ${peopleMap.size} unique people`);
  let contactIdx = 0;
  for (const [email, info] of peopleMap) {
    const entry = buildContactEntry(email, info.name, [...info.projects], info.timeReports);
    if (DRY_RUN) {
      if (contactIdx < 5) console.log(`  [dry] ${entry.identity_key}: ${entry.title}`);
    } else {
      try {
        await captureAndIndex(vaultCtx, entry);
        stats.contacts++;
      } catch (e) {
        console.error(`\n  Error saving contact ${email}: ${e.message}`);
      }
    }
    contactIdx++;
    progressLog('Contacts', contactIdx, peopleMap.size);
  }
  if (DRY_RUN) stats.contacts = peopleMap.size;

  // ------- Sprints (events) -------
  const sprints = src.prepare('SELECT * FROM sprints').all();
  console.log(`\nSprints: ${sprints.length} rows`);
  for (let i = 0; i < sprints.length; i++) {
    if (!DRY_RUN && isAlreadyImported(vaultCtx.db, sprints[i].id)) {
      stats.skipped++;
      progressLog('Sprints', i + 1, sprints.length);
      continue;
    }
    const entry = buildSprintEntry(sprints[i]);
    if (DRY_RUN) {
      if (i < 3) console.log(`  [dry] ${entry.title} (${entry.tier})`);
    } else {
      try {
        await captureAndIndex(vaultCtx, entry);
        stats.sprints++;
      } catch (e) {
        console.error(`\n  Error saving sprint ${entry.title}: ${e.message}`);
      }
    }
    progressLog('Sprints', i + 1, sprints.length);
  }
  if (DRY_RUN) stats.sprints = sprints.length;

  // ------- Tasks (events) -------
  const tasks = src.prepare('SELECT * FROM tasks').all();
  console.log(`\nTasks: ${tasks.length} rows`);
  for (let i = 0; i < tasks.length; i++) {
    if (!DRY_RUN && isAlreadyImported(vaultCtx.db, tasks[i].id)) {
      stats.skipped++;
      progressLog('Tasks', i + 1, tasks.length);
      continue;
    }
    const entry = buildTaskEntry(tasks[i]);
    if (DRY_RUN) {
      if (i < 3) console.log(`  [dry] ${entry.title} (${entry.tags.join(', ')})`);
    } else {
      try {
        await captureAndIndex(vaultCtx, entry);
        stats.tasks++;
      } catch (e) {
        console.error(`\n  Error saving task ${entry.title}: ${e.message}`);
      }
    }
    progressLog('Tasks', i + 1, tasks.length);
  }
  if (DRY_RUN) stats.tasks = tasks.length;

  // ------- Time Reports (events) -------
  const timeReports = src.prepare('SELECT * FROM time_reports').all();
  console.log(`\nTime Reports: ${timeReports.length} rows`);
  for (let i = 0; i < timeReports.length; i++) {
    if (!DRY_RUN && isAlreadyImported(vaultCtx.db, timeReports[i].id)) {
      stats.skipped++;
      progressLog('Time Reports', i + 1, timeReports.length);
      continue;
    }
    const entry = buildTimeEntry(timeReports[i]);
    if (DRY_RUN) {
      if (i < 3) console.log(`  [dry] ${entry.title}`);
    } else {
      try {
        await captureAndIndex(vaultCtx, entry);
        stats.timeEntries++;
      } catch (e) {
        console.error(`\n  Error saving time entry: ${e.message}`);
      }
    }
    progressLog('Time Reports', i + 1, timeReports.length);
  }
  if (DRY_RUN) stats.timeEntries = timeReports.length;

  // ------- Summary -------
  console.log(`\n${'='.repeat(50)}`);
  console.log(`${DRY_RUN ? 'Would import' : 'Imported'}:`);
  console.log(`  Projects:     ${stats.projects}`);
  console.log(`  Contacts:     ${stats.contacts}`);
  console.log(`  Sprints:      ${stats.sprints}`);
  console.log(`  Tasks:        ${stats.tasks}`);
  console.log(`  Time Entries: ${stats.timeEntries}`);
  if (stats.skipped > 0) {
    console.log(`  Skipped (already imported): ${stats.skipped}`);
  }
  console.log(`${'='.repeat(50)}`);

  src.close();
  if (vaultCtx) {
    try { vaultCtx.db.close(); } catch {}
  }
}

main().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
