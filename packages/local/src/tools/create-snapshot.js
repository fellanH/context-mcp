import { z } from "zod";
import { hybridSearch } from "@context-vault/core/search";
import { captureAndIndex } from "@context-vault/core/capture";
import { normalizeKind } from "@context-vault/core/files";
import { ok, err, ensureVaultExists } from "../helpers.js";

const NOISE_KINDS = new Set(["prompt-history", "task-notification"]);
const MAX_ENTRIES_FOR_GATHER = 40;
const MAX_BODY_PER_ENTRY = 600;

export const name = "create_snapshot";

export const description =
  "Pull all relevant vault entries matching a topic, deduplicate, and save them as a structured context brief (kind: 'brief'). Entries are formatted as markdown — no external API or LLM call required. The calling agent can synthesize the gathered content directly. Retrieve with: get_context(kind: 'brief', identity_key: '<key>').";

export const inputSchema = {
  topic: z.string().describe("The topic or project name to snapshot"),
  tags: z
    .array(z.string())
    .optional()
    .describe("Optional tag filters — entries must match at least one"),
  buckets: z
    .array(z.string())
    .optional()
    .describe(
      "Filter by project-scoped buckets. Each name expands to a 'bucket:<name>' tag. Composes with 'tags' via OR (entries matching any tag or any bucket are included).",
    ),
  kinds: z
    .array(z.string())
    .optional()
    .describe("Optional kind filters to restrict which entry types are pulled"),
  identity_key: z
    .string()
    .optional()
    .describe(
      "Deterministic key for the saved brief (defaults to slugified topic). Use the same key to overwrite a previous snapshot.",
    ),
};

function formatGatheredEntries(topic, entries) {
  const header = [
    `# ${topic} — Context Brief`,
    "",
    `*Gathered from ${entries.length} vault ${entries.length === 1 ? "entry" : "entries"}. Synthesize the content below to extract key decisions, patterns, and constraints.*`,
    "",
    "---",
    "",
  ].join("\n");

  const body = entries
    .map((e, i) => {
      const tags = e.tags ? JSON.parse(e.tags) : [];
      const tagStr = tags.length ? tags.join(", ") : "none";
      const updated = e.updated_at || e.created_at || "unknown";
      const bodyText = e.body
        ? e.body.slice(0, MAX_BODY_PER_ENTRY) +
          (e.body.length > MAX_BODY_PER_ENTRY ? "…" : "")
        : "(no body)";
      const title = e.title || `Entry ${i + 1}`;
      return [
        `## ${i + 1}. [${e.kind}] ${title}`,
        "",
        `**Tags:** ${tagStr}`,
        `**Updated:** ${updated}`,
        `**ID:** \`${e.id}\``,
        "",
        bodyText,
        "",
        "---",
        "",
      ].join("\n");
    })
    .join("");

  return header + body;
}

function slugifyTopic(topic) {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export async function handler(
  { topic, tags, buckets, kinds, identity_key },
  ctx,
  { ensureIndexed },
) {
  const { config } = ctx;

  const vaultErr = ensureVaultExists(config);
  if (vaultErr) return vaultErr;

  if (!topic?.trim()) {
    return err("Required: topic (non-empty string)", "INVALID_INPUT");
  }

  await ensureIndexed();

  const normalizedKinds = kinds?.map(normalizeKind) ?? [];
  const bucketTags = buckets?.length ? buckets.map((b) => `bucket:${b}`) : [];
  const effectiveTags = [...(tags ?? []), ...bucketTags];

  let candidates = [];

  if (normalizedKinds.length > 0) {
    for (const kindFilter of normalizedKinds) {
      const rows = await hybridSearch(ctx, topic, {
        kindFilter,
        limit: Math.ceil(MAX_ENTRIES_FOR_GATHER / normalizedKinds.length),
        
        includeSuperseeded: false,
      });
      candidates.push(...rows);
    }
    const seen = new Set();
    candidates = candidates.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  } else {
    candidates = await hybridSearch(ctx, topic, {
      limit: MAX_ENTRIES_FOR_GATHER,
      
      includeSuperseeded: false,
    });
  }

  if (effectiveTags.length) {
    candidates = candidates.filter((r) => {
      const entryTags = r.tags ? JSON.parse(r.tags) : [];
      return effectiveTags.some((t) => entryTags.includes(t));
    });
  }

  const noiseIds = candidates
    .filter((r) => NOISE_KINDS.has(r.kind))
    .map((r) => r.id);

  const gatherEntries = candidates.filter((r) => !NOISE_KINDS.has(r.kind));

  if (gatherEntries.length === 0) {
    return err(
      `No entries found for topic "${topic}". Try a broader topic or different tags.`,
      "NO_ENTRIES",
    );
  }

  const briefBody = formatGatheredEntries(topic, gatherEntries);

  const effectiveIdentityKey =
    identity_key ?? `snapshot-${slugifyTopic(topic)}`;

  const briefTags = [
    "snapshot",
    ...(tags ?? []),
    ...(normalizedKinds.length > 0 ? [] : []),
  ];

  const supersedes = noiseIds.length > 0 ? noiseIds : undefined;

  const entry = await captureAndIndex(ctx, {
    kind: "brief",
    title: `${topic} — Context Brief`,
    body: briefBody,
    tags: briefTags,
    source: "create_snapshot",
    identity_key: effectiveIdentityKey,
    supersedes,
    
    meta: {
      topic,
      entry_count: gatherEntries.length,
      noise_superseded: noiseIds.length,
      synthesized_from: gatherEntries.map((e) => e.id),
    },
  });

  const parts = [
    `✓ Snapshot created → id: ${entry.id}`,
    `  title: ${entry.title}`,
    `  identity_key: ${effectiveIdentityKey}`,
    `  synthesized from: ${gatherEntries.length} entries`,
    noiseIds.length > 0
      ? `  noise superseded: ${noiseIds.length} entries`
      : null,
    "",
    "_Retrieve with: get_context(kind: 'brief', identity_key: '" +
      effectiveIdentityKey +
      "')_",
  ]
    .filter((l) => l !== null)
    .join("\n");

  return ok(parts);
}
