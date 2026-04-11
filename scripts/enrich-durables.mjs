#!/usr/bin/env node
// enrich-durables.mjs — Generate encoding_context for durable vault entries
// and embed them into vault_ctx_vec for associative recall.
//
// Usage: node scripts/enrich-durables.mjs [--dry-run] [--limit N]
// Idempotent: re-running updates encoding_context and re-embeds.

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = join(__dirname, '..');

// Use the workspace-local node_modules so we get v3.15.0 with insertCtxVec
const require = createRequire(join(MCP_ROOT, 'package.json'));
const sqliteVec = require('./node_modules/sqlite-vec/index.cjs');

const { embed, embedBatch } = await import(join(MCP_ROOT, 'node_modules/@context-vault/core/dist/embed.js'));
const { resolveConfig } = await import(join(MCP_ROOT, 'node_modules/@context-vault/core/dist/config.js'));
const { prepareStatements, insertCtxVec, deleteCtxVec } = await import(join(MCP_ROOT, 'node_modules/@context-vault/core/dist/db.js'));

// CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.findIndex(a => a === '--limit');
const LIMIT = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : Infinity;
const BATCH_SIZE = 8;

// ---------------------------------------------------------------------------
// Tag expansion map
// ---------------------------------------------------------------------------
const TAG_EXPANSIONS = {
  'section-system': 'section system, website sections, HTML sections, composable blocks, section library',
  'pipeline': 'build pipeline, generation pipeline, website pipeline, automated pipeline, content pipeline',
  'pipeline-v2': 'pipeline version 2, new pipeline, pipeline rearchitecture, universal pipeline',
  'architecture': 'software architecture, system design, technical architecture, code architecture, structural decisions',
  'bucket:kaizen': 'Kaizen project, website builder, DFY websites, client websites, done-for-you sites',
  'bucket:klarhimmel': 'Klarhimmel, parent brand, consulting brand, brand architecture, IT consulting',
  'bucket:omni': 'omni system, agent system, AI orchestration, workspace management, agent infrastructure',
  'bucket:context-vault': 'context vault, persistent memory, vault system, MCP memory, knowledge storage',
  'bucket:stormfors': 'Stormfors, employment, Stormfors Leadfront, sales platform',
  'bucket:leadfront': 'Leadfront, sales platform, CRM, lead management, sales pipeline',
  'bucket:nordstay': 'Nordstay, property rental, accommodation, short-term rental',
  'bucket:personal': 'personal projects, side projects, personal decisions',
  'positioning': 'brand positioning, marketing positioning, sales pitch, client messaging, value proposition',
  'brand-factory': 'brand factory, brand experiments, brand deployment, new brands, brand creation',
  'product-decision': 'product decision, product strategy, product direction, product planning',
  'north-star': 'strategic direction, vision, long-term goals, strategic priorities',
  'infrastructure': 'infrastructure, deployment, hosting, DNS, email setup, cloud services',
  'email': 'email infrastructure, email routing, email setup, transactional email, email deliverability',
  'css': 'CSS, styling, design system, visual design, stylesheets',
  'tailwind': 'Tailwind CSS, utility-first CSS, Tailwind configuration, CSS framework',
  'gemini': 'Gemini AI, Google AI, content generation, LLM, language model',
  'design': 'web design, UI design, visual design, design quality, aesthetics',
  'revenue': 'revenue, sales, monetization, business model, income',
  'compliance': 'compliance, regulatory, NIS2, GDPR, legal requirements, EU regulations',
  'agent-behavior': 'agent behavior, AI agent rules, agent patterns, agent conventions',
  'orchestration': 'agent orchestration, multi-agent, tmux agents, worker agents, PM agents',
  'tmux': 'tmux sessions, terminal multiplexer, agent sessions, tmux workers',
  'mcp': 'MCP protocol, model context protocol, MCP server, MCP tools',
  'tooling': 'tooling, developer tools, scripts, automation, utilities',
  'service-catalog': 'service catalog, available services, tooling inventory',
  'pattern': 'design pattern, code pattern, recurring solution, best practice',
  'decision': 'architectural decision, design choice, technical decision',
  'insight': 'insight, lesson learned, observation, discovery',
  'event': 'event, milestone, project event, session event',
  'strategy': 'strategy, strategic planning, long-term direction, goals',
  'career': 'career, professional development, employment, work',
  'react': 'React, React 19, component-based UI, JSX',
  'nextjs': 'Next.js, Next.js app router, server components, React framework',
  'typescript': 'TypeScript, type safety, typed JavaScript',
  'sqlite': 'SQLite, local database, embedded database, file-based database',
  'supabase': 'Supabase, cloud database, PostgreSQL, authentication',
  'cloudflare': 'Cloudflare, CDN, DNS, edge computing, workers',
  'webflow': 'Webflow, no-code website builder, visual design tool',
  'notion': 'Notion, project management, documentation, workspace',
  'stripe': 'Stripe, payments, subscription billing, checkout',
  'vault-hygiene': 'vault hygiene, knowledge management, memory maintenance',
  'multi-agent': 'multi-agent, parallel agents, concurrent AI workers',
  'agent-prompts': 'agent prompts, prompt engineering, system prompts, instructions',
  'system-review': 'system review, audit, health check, retrospective',
  'brand': 'brand, branding, visual identity, brand guidelines',
  'content': 'content, copywriting, marketing content, website copy',
  'seo': 'SEO, search engine optimization, organic search, indexing',
  'analytics': 'analytics, tracking, metrics, user behavior',
  'testing': 'testing, automated tests, quality assurance, test coverage',
  'security': 'security, authentication, authorization, access control',
  'performance': 'performance, speed, optimization, loading time',
};

// Technology names to recognize in body text
const TECH_TERMS = [
  'React', 'Next.js', 'HTML', 'CSS', 'Tailwind', 'TypeScript', 'JavaScript',
  'Node.js', 'Express', 'SQLite', 'Supabase', 'Cloudflare', 'Vercel', 'Netlify',
  'Webflow', 'HubSpot', 'Stripe', 'Notion', 'Gemini', 'Claude', 'OpenAI',
  'MCP', 'tmux', 'GitHub', 'Vite', 'Webpack', 'esbuild', 'Playwright',
  'Vitest', 'Docker', 'AWS', 'GCP', 'Azure', 'DNS', 'API', 'REST', 'GraphQL',
  'PostgreSQL', 'MySQL', 'Redis', 'MongoDB', 'SQLite', 'Prisma',
  'FastAPI', 'Python', 'Go', 'Rust', 'Swift', 'Kotlin',
  'BankID', 'Swish', 'Peppol', 'GDPR', 'NIS2',
  'Kaizen', 'Klarhimmel', 'Stormfors', 'Leadfront', 'Nordstay',
];

const TECH_PATTERN = new RegExp(`\\b(${TECH_TERMS.map(t => t.replace(/\./g, '\\.')).join('|')})\\b`, 'g');

// ---------------------------------------------------------------------------
// encoding_context generator
// ---------------------------------------------------------------------------
function generateEncodingContext(entry) {
  const { title, body, tags } = entry;
  const parsedTags = tags ? JSON.parse(tags) : [];

  // Extract topic phrases from title
  const titlePhrases = extractTitlePhrases(title || '');

  // Expand tags
  const tagExpansions = [];
  for (const tag of parsedTags) {
    if (TAG_EXPANSIONS[tag]) {
      tagExpansions.push(TAG_EXPANSIONS[tag]);
    } else {
      // Generic expansion: replace hyphens with spaces, remove bucket: prefix
      const cleaned = tag.replace(/^bucket:/, '').replace(/-/g, ' ');
      if (cleaned && cleaned.length > 2) tagExpansions.push(cleaned);
    }
  }

  // Extract tech terms and domain phrases from body (first 500 chars)
  const bodySnippet = (body || '').slice(0, 500);
  const techMatches = [...new Set([...bodySnippet.matchAll(TECH_PATTERN)].map(m => m[0]))];
  const domainPhrases = extractDomainPhrases(bodySnippet);

  // Determine broader categories from tags
  const relatedDomains = inferDomains(parsedTags, title || '', bodySnippet);

  // Determine casual conversation triggers
  const conversationTriggers = inferConversationTriggers(parsedTags, title || '', bodySnippet, techMatches);

  // Compose encoding_context
  const topicPhrases = [
    ...titlePhrases,
    ...techMatches,
    ...domainPhrases,
    ...tagExpansions.slice(0, 3),
  ].filter(Boolean);

  const uniqueTopics = dedup(topicPhrases);
  const uniqueDomains = dedup(relatedDomains);
  const uniqueTriggers = dedup(conversationTriggers);

  return [
    `This decision applies when discussing: ${uniqueTopics.slice(0, 12).join(', ')}`,
    `Related domains: ${uniqueDomains.slice(0, 6).join(', ')}`,
    `Triggered by conversations about: ${uniqueTriggers.slice(0, 8).join(', ')}`,
  ].join('\n');
}

function extractTitlePhrases(title) {
  // Split on common separators, keep multi-word phrases and key terms
  const parts = title
    .replace(/[^\w\s.:'/-]/g, ' ')
    .split(/\s{2,}|\s*:\s*|\s*—\s*|\s*-\s*(?=[A-Z])/)
    .map(p => p.trim())
    .filter(p => p.length > 3);

  // Also extract individual words that are meaningful (capitalized or tech terms)
  const words = title.match(/\b[A-Z][a-zA-Z.]+\b/g) || [];

  return [...parts, ...words];
}

function extractDomainPhrases(body) {
  const phrases = [];

  // Extract capitalized multi-word phrases (likely proper nouns or tech names)
  const capitalizedPhrases = body.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+\b/g) || [];
  phrases.push(...capitalizedPhrases.slice(0, 5));

  // Extract quoted terms
  const quoted = body.match(/"([^"]{4,40})"/g) || [];
  phrases.push(...quoted.map(q => q.replace(/"/g, '')).slice(0, 3));

  // Extract terms after "vs", "over", "instead of" (decision language)
  const decisionPhrases = body.match(/\b(?:vs\.?|over|instead of|rather than)\s+([a-zA-Z][a-zA-Z\s.]{3,30})/gi) || [];
  phrases.push(...decisionPhrases.map(p => p.replace(/^(?:vs\.?|over|instead of|rather than)\s+/i, '')).slice(0, 3));

  return phrases;
}

function inferDomains(tags, title, body) {
  const domains = [];

  if (tags.some(t => t.includes('kaizen') || t.includes('pipeline') || t.includes('section'))) {
    domains.push('frontend architecture', 'website generation', 'web development');
  }
  if (tags.some(t => t.includes('architecture') || t.includes('decision'))) {
    domains.push('software architecture', 'system design', 'technical decisions');
  }
  if (tags.some(t => t.includes('agent') || t.includes('tmux') || t.includes('orchestration') || t.includes('omni'))) {
    domains.push('AI agent systems', 'agent orchestration', 'automated workflows');
  }
  if (tags.some(t => t.includes('brand') || t.includes('positioning') || t.includes('marketing'))) {
    domains.push('brand strategy', 'marketing', 'client positioning');
  }
  if (tags.some(t => t.includes('revenue') || t.includes('strategy') || t.includes('career'))) {
    domains.push('business strategy', 'revenue planning', 'professional decisions');
  }
  if (tags.some(t => t.includes('infra') || t.includes('email') || t.includes('dns') || t.includes('cloudflare'))) {
    domains.push('infrastructure', 'deployment', 'DevOps');
  }
  if (tags.some(t => t.includes('context-vault') || t.includes('mcp') || t.includes('vault'))) {
    domains.push('developer tools', 'knowledge management', 'MCP protocol');
  }
  if (tags.some(t => t.includes('compliance') || t.includes('legal'))) {
    domains.push('regulatory compliance', 'legal requirements', 'EU regulations');
  }

  // Also infer from title keywords
  const titleLower = title.toLowerCase();
  if (titleLower.includes('css') || titleLower.includes('style') || titleLower.includes('design')) {
    domains.push('CSS', 'visual design', 'styling');
  }
  if (titleLower.includes('next') || titleLower.includes('react') || titleLower.includes('component')) {
    domains.push('React ecosystem', 'Next.js', 'component architecture');
  }

  return domains;
}

function inferConversationTriggers(tags, title, body, techMatches) {
  const triggers = [];
  const titleLower = title.toLowerCase();

  // Project/context triggers from tags
  if (tags.some(t => t.includes('kaizen'))) {
    triggers.push('building websites for clients', 'DFY website services', 'website builder', 'Kaizen platform');
  }
  if (tags.some(t => t.includes('pipeline') || t.includes('section'))) {
    triggers.push('website generation pipeline', 'building marketing pages', 'section-based layouts', 'composable websites');
  }
  if (tags.some(t => t.includes('klarhimmel'))) {
    triggers.push('consulting brand identity', 'agency positioning', 'Klarhimmel services');
  }
  if (tags.some(t => t.includes('omni') || t.includes('agent') || t.includes('orchestration'))) {
    triggers.push('running AI agents', 'multi-agent workflows', 'agent orchestration setup', 'tmux-based agents');
  }
  if (tags.some(t => t.includes('context-vault'))) {
    triggers.push('persistent agent memory', 'knowledge management for AI', 'MCP memory tools');
  }
  if (tags.some(t => t.includes('revenue') || t.includes('strategy'))) {
    triggers.push('business strategy', 'revenue model', 'pricing decisions', 'client acquisition');
  }

  // Tech-stack triggers from tech matches
  for (const tech of techMatches) {
    if (tech === 'Next.js') triggers.push('choosing Next.js', 'Next.js for marketing sites', 'React frameworks');
    if (tech === 'React') triggers.push('React component design', 'frontend framework choice');
    if (tech === 'Tailwind') triggers.push('Tailwind CSS setup', 'utility-first styling', 'CSS framework choice');
    if (tech === 'SQLite') triggers.push('local database choice', 'SQLite for production', 'database architecture');
    if (tech === 'Cloudflare') triggers.push('Cloudflare setup', 'DNS management', 'edge hosting');
    if (tech === 'Webflow') triggers.push('Webflow integration', 'no-code CMS', 'design tool to code');
    if (tech === 'Stripe') triggers.push('payment integration', 'subscription billing', 'Stripe setup');
    if (tech === 'Gemini') triggers.push('AI model selection', 'LLM for content generation', 'Google AI');
    if (tech === 'Claude') triggers.push('Claude AI integration', 'Anthropic API', 'Claude for code generation');
    if (tech === 'MCP') triggers.push('MCP server setup', 'model context protocol', 'tool calling');
  }

  // General triggers based on decision/insight nature
  if (titleLower.includes('beat') || titleLower.includes('over') || titleLower.includes('vs')) {
    triggers.push('comparing alternatives', 'technology choice', 'architecture tradeoffs');
  }
  if (titleLower.includes('pattern') || titleLower.includes('convention')) {
    triggers.push('code conventions', 'team standards', 'best practices');
  }
  if (titleLower.includes('deploy') || titleLower.includes('launch')) {
    triggers.push('deployment strategy', 'going to production', 'launch planning');
  }
  if (titleLower.includes('agent') || titleLower.includes('worker')) {
    triggers.push('agent task design', 'worker prompt engineering', 'agent instructions');
  }

  return triggers;
}

function dedup(arr) {
  const seen = new Set();
  return arr.filter(item => {
    const key = item.toLowerCase().trim();
    if (seen.has(key) || !key) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Opening vault database...');
  const config = await resolveConfig({});
  const dbPath = join(homedir(), '.context-mcp', 'vault.db');

  const db = new DatabaseSync(dbPath, { allowExtension: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 10000');
  sqliteVec.load(db);

  const stmts = prepareStatements(db);

  // Get all durable entries
  const entries = db.prepare(
    `SELECT rowid, id, title, body, tags, tier FROM vault WHERE tier = 'durable' ORDER BY rowid`
  ).all();

  const total = Math.min(entries.length, isFinite(LIMIT) ? LIMIT : entries.length);
  console.log(`Found ${entries.length} durable entries. Processing ${total}...`);
  if (DRY_RUN) console.log('[DRY RUN MODE: no database writes]');

  let enriched = 0;
  let skipped = 0;
  const sampleOutputs = [];

  // Check which rowids already have ctx_vec (for progress tracking only)
  const existingCtxVecs = new Set(
    db.prepare('SELECT rowid FROM vault_ctx_vec').all().map(r => Number(r.rowid))
  );

  // Process in batches for embedding efficiency
  const batch = [];
  const toProcess = entries.slice(0, total);

  for (let i = 0; i < toProcess.length; i++) {
    const entry = toProcess[i];
    const encodingCtx = generateEncodingContext(entry);
    batch.push({ entry, encodingCtx });
  }

  console.log(`\nGenerating encoding_context for ${batch.length} entries...`);

  // Embed in BATCH_SIZE chunks
  for (let i = 0; i < batch.length; i += BATCH_SIZE) {
    const chunk = batch.slice(i, i + BATCH_SIZE);
    const texts = chunk.map(b => b.encodingCtx);
    const chunkNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalChunks = Math.ceil(batch.length / BATCH_SIZE);
    process.stdout.write(`\r  Embedding batch ${chunkNum}/${totalChunks} (entries ${i + 1}-${Math.min(i + BATCH_SIZE, batch.length)} of ${batch.length})...`);

    let embeddings;
    if (DRY_RUN) {
      embeddings = texts.map(() => null);
    } else {
      embeddings = await embedBatch(texts);
    }

    for (let j = 0; j < chunk.length; j++) {
      const { entry, encodingCtx } = chunk[j];
      const embedding = embeddings[j];
      const rowid = Number(entry.rowid);

      if (!DRY_RUN) {
        // Remove existing ctx_vec entry if present
        if (existingCtxVecs.has(rowid)) {
          try { deleteCtxVec(stmts, rowid); } catch {}
        }

        // Insert new ctx_vec
        if (embedding) {
          try {
            insertCtxVec(stmts, rowid, embedding);
            enriched++;
          } catch (e) {
            console.error(`\n  Failed to insert ctx_vec for entry ${entry.id}: ${e.message}`);
            skipped++;
          }
        } else {
          console.warn(`\n  No embedding generated for entry ${entry.id} (${entry.title})`);
          skipped++;
        }
      } else {
        enriched++;
      }

      // Collect samples for display
      if (sampleOutputs.length < 3) {
        sampleOutputs.push({
          title: entry.title,
          tags: entry.tags ? JSON.parse(entry.tags) : [],
          encoding_context: encodingCtx,
        });
      }
    }
  }

  process.stdout.write('\n');

  // Print stats
  console.log(`\n=== Results ===`);
  console.log(`  Entries processed: ${total}`);
  console.log(`  ctx_vec entries written: ${enriched}`);
  if (skipped > 0) console.log(`  Skipped (embed failure): ${skipped}`);

  // Print samples
  console.log(`\n=== Sample encoding_context (first 3 entries) ===`);
  for (const sample of sampleOutputs) {
    console.log(`\nTitle: ${sample.title}`);
    console.log(`Tags: ${sample.tags.join(', ')}`);
    console.log(`Encoding context:\n${sample.encoding_context.split('\n').map(l => '  ' + l).join('\n')}`);
  }

  // Verify counts
  if (!DRY_RUN) {
    const newCtxCount = db.prepare('SELECT COUNT(*) as c FROM vault_ctx_vec').get().c;
    const durableCount = db.prepare("SELECT COUNT(*) as c FROM vault WHERE tier = 'durable'").get().c;
    console.log(`\n=== Verification ===`);
    console.log(`  Durable entries: ${durableCount}`);
    console.log(`  vault_ctx_vec entries: ${newCtxCount}`);
    console.log(`  Coverage: ${Math.round(newCtxCount / durableCount * 100)}% of durables have ctx_vec`);
  }

  db.close();
  console.log('\nDone.');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
