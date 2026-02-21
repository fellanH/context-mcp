#!/usr/bin/env node
/**
 * Free-tier overhead and usage cost per user onboarded.
 * Uses the same limits as packages/hosted/src/billing/stripe.js.
 * Run: node scripts/free-tier-calc.mjs
 */

const FREE = {
  maxEntries: 500,
  storageMb: 10,
  requestsPerDay: 200,
};

const BYTES_PER_MB = 1024 * 1024;

// Assumptions for "typical" usage
const AVG_ENTRY_SIZE_BYTES = 2048; // ~2 KB per entry (body + title + meta + overhead)
const AVG_ENTRY_SIZE_KB = (AVG_ENTRY_SIZE_BYTES / 1024).toFixed(1);

function fmt(n, unit = "") {
  return n === Infinity ? "∞" : `${Number(n).toLocaleString()}${unit}`;
}

console.log("═══════════════════════════════════════════════════════════════");
console.log("  Context Vault — Free tier usage & how far it stretches");
console.log(
  "═══════════════════════════════════════════════════════════════\n",
);

console.log("Free tier limits (from stripe.js):");
console.log(`  • Entries:     ${fmt(FREE.maxEntries)}`);
console.log(`  • Storage:     ${fmt(FREE.storageMb)} MB`);
console.log(
  `  • MCP ops/day: ${fmt(FREE.requestsPerDay)} (per HTTP request to /mcp)\n`,
);

// Storage: entries → MB
const storagePerEntryMb = AVG_ENTRY_SIZE_BYTES / BYTES_PER_MB;
const entriesToFillStorage = Math.floor(
  (FREE.storageMb * BYTES_PER_MB) / AVG_ENTRY_SIZE_BYTES,
);
console.log("Storage (assuming ~" + AVG_ENTRY_SIZE_KB + " KB per entry):");
console.log(`  • 1 entry     ≈ ${(storagePerEntryMb * 1).toFixed(4)} MB`);
console.log(`  • 100 entries ≈ ${(storagePerEntryMb * 100).toFixed(2)} MB`);
console.log(
  `  • 500 entries ≈ ${(storagePerEntryMb * 500).toFixed(2)} MB (limit)`,
);
console.log(
  `  • Storage limit (${FREE.storageMb} MB) ≈ ${fmt(entriesToFillStorage)} entries at this size`,
);
const cap = Math.min(FREE.maxEntries, entriesToFillStorage);
console.log(`  → Effective cap: ${fmt(cap)} entries (first limit hit)\n`);

// Requests per day
console.log(
  "MCP operations per day (200 = one count per HTTP request to /mcp):",
);
console.log(
  `  • 200/day ≈ ${(200 / 24).toFixed(0)}/hour (24h) or ${(200 / 8).toFixed(0)}/hour (8h workday)`,
);
console.log(
  `  • Typical session: 1 connection, many tool calls → 1 request counted`,
);
console.log(`  → 200 "sessions" or 200 distinct MCP HTTP requests per day\n`);

// Per-user scenarios
console.log("Per-user scenarios (free tier):");
const scenarios = [
  { entries: 50, reqPerDay: 30, label: "Light (small vault, few sessions)" },
  { entries: 200, reqPerDay: 80, label: "Medium (growing vault, daily use)" },
  { entries: 500, reqPerDay: 150, label: "Heavy (max entries, high activity)" },
  { entries: 500, reqPerDay: 200, label: "At limit (entries + requests)" },
];
for (const s of scenarios) {
  const storageMb = (s.entries * AVG_ENTRY_SIZE_BYTES) / BYTES_PER_MB;
  const entriesOk = s.entries <= FREE.maxEntries;
  const storageOk = storageMb <= FREE.storageMb;
  const requestsOk = s.reqPerDay <= FREE.requestsPerDay;
  const status = entriesOk && storageOk && requestsOk ? "✓" : "✗";
  console.log(`  ${status} ${s.label}`);
  console.log(
    `      ${s.entries} entries, ${storageMb.toFixed(2)} MB, ${s.reqPerDay} req/day → entries: ${entriesOk ? "ok" : "over"}, storage: ${storageOk ? "ok" : "over"}, requests: ${requestsOk ? "ok" : "over"}`,
  );
}
console.log("");

// How many such users can "fit" on free tier (conceptual — we're not multi-tenant by storage, so this is "per user")
console.log("Summary — how far the free tier stretches:");
console.log(
  `  • Entries: Up to ${FREE.maxEntries} entries (storage usually hits first at ~${AVG_ENTRY_SIZE_KB} KB/entry: ${entriesToFillStorage} entries in ${FREE.storageMb} MB).`,
);
console.log(
  `  • Requests: ${FREE.requestsPerDay}/day — enough for dozens of agent sessions if each session = 1 MCP request.`,
);
console.log(
  `  • Bottleneck: For large entries (~5 KB avg), storage caps at ~${Math.floor((FREE.storageMb * BYTES_PER_MB) / (5 * 1024))} entries; for small (~0.5 KB), entry count (${FREE.maxEntries}) caps first.`,
);
console.log("");
