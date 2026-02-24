import { z } from "zod";
import { hybridSearch } from "../../retrieve/index.js";
import { captureAndIndex } from "../../capture/index.js";
import { normalizeKind } from "../../core/files.js";
import { ok, err, ensureVaultExists } from "../helpers.js";

const NOISE_KINDS = new Set(["prompt-history", "task-notification"]);
const SYNTHESIS_MODEL = "claude-haiku-4-5-20251001";
const MAX_ENTRIES_FOR_SYNTHESIS = 40;
const MAX_BODY_PER_ENTRY = 600;

export const name = "create_snapshot";

export const description =
  "Pull all relevant vault entries matching a topic, run an LLM synthesis pass to deduplicate and structure them into a context brief, then save and return the brief's ULID. The brief is saved as kind: 'brief' with a deterministic identity_key for retrieval.";

export const inputSchema = {
  topic: z.string().describe("The topic or project name to snapshot"),
  tags: z
    .array(z.string())
    .optional()
    .describe("Optional tag filters — entries must match at least one"),
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

function buildSynthesisPrompt(topic, entries) {
  const entriesBlock = entries
    .map((e, i) => {
      const tags = e.tags ? JSON.parse(e.tags) : [];
      const tagStr = tags.length ? tags.join(", ") : "none";
      const body = e.body
        ? e.body.slice(0, MAX_BODY_PER_ENTRY) +
          (e.body.length > MAX_BODY_PER_ENTRY ? "…" : "")
        : "(no body)";
      return [
        `### Entry ${i + 1} [${e.kind}] id: ${e.id}`,
        `tags: ${tagStr}`,
        `updated: ${e.updated_at || e.created_at || "unknown"}`,
        body,
      ].join("\n");
    })
    .join("\n\n");

  return `You are a knowledge synthesis assistant. Given the following vault entries about "${topic}", produce a structured context brief.

Deduplicate overlapping information, resolve any contradictions (note them in Audit Notes), and organise the content into the sections below. Keep each section concise and actionable. Omit sections that have no relevant content.

Output ONLY the markdown document — no preamble, no explanation.

Required format:
# ${topic} — Context Brief
## Status
(current state of the topic)
## Key Decisions
(architectural or strategic decisions made)
## Patterns & Conventions
(recurring patterns, coding conventions, standards)
## Active Constraints
(known limitations, hard requirements, deadlines)
## Open Questions
(unresolved questions or areas needing investigation)
## Audit Notes
(contradictions detected, stale entries flagged with their ids)

---
VAULT ENTRIES:

${entriesBlock}`;
}

async function callLlm(prompt) {
  const { Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const message = await client.messages.create({
    model: SYNTHESIS_MODEL,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });
  const block = message.content.find((b) => b.type === "text");
  if (!block) throw new Error("LLM returned no text content");
  return block.text;
}

function slugifyTopic(topic) {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export async function handler(
  { topic, tags, kinds, identity_key },
  ctx,
  { ensureIndexed },
) {
  const { config } = ctx;
  const userId = ctx.userId !== undefined ? ctx.userId : undefined;

  const vaultErr = ensureVaultExists(config);
  if (vaultErr) return vaultErr;

  if (!topic?.trim()) {
    return err("Required: topic (non-empty string)", "INVALID_INPUT");
  }

  await ensureIndexed();

  const normalizedKinds = kinds?.map(normalizeKind) ?? [];

  let candidates = [];

  if (normalizedKinds.length > 0) {
    for (const kindFilter of normalizedKinds) {
      const rows = await hybridSearch(ctx, topic, {
        kindFilter,
        limit: Math.ceil(MAX_ENTRIES_FOR_SYNTHESIS / normalizedKinds.length),
        userIdFilter: userId,
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
      limit: MAX_ENTRIES_FOR_SYNTHESIS,
      userIdFilter: userId,
      includeSuperseeded: false,
    });
  }

  if (tags?.length) {
    candidates = candidates.filter((r) => {
      const entryTags = r.tags ? JSON.parse(r.tags) : [];
      return tags.some((t) => entryTags.includes(t));
    });
  }

  const noiseIds = candidates
    .filter((r) => NOISE_KINDS.has(r.kind))
    .map((r) => r.id);

  const synthesisEntries = candidates.filter((r) => !NOISE_KINDS.has(r.kind));

  if (synthesisEntries.length === 0) {
    return err(
      `No entries found for topic "${topic}" to synthesize. Try a broader topic or different tags.`,
      "NO_ENTRIES",
    );
  }

  let briefBody;
  try {
    const prompt = buildSynthesisPrompt(topic, synthesisEntries);
    briefBody = await callLlm(prompt);
  } catch (e) {
    return err(
      `LLM synthesis failed: ${e.message}. Ensure ANTHROPIC_API_KEY is set.`,
      "LLM_ERROR",
    );
  }

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
    userId,
    meta: {
      topic,
      entry_count: synthesisEntries.length,
      noise_superseded: noiseIds.length,
      synthesized_from: synthesisEntries.map((e) => e.id),
    },
  });

  const parts = [
    `✓ Snapshot created → id: ${entry.id}`,
    `  title: ${entry.title}`,
    `  identity_key: ${effectiveIdentityKey}`,
    `  synthesized from: ${synthesisEntries.length} entries`,
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
