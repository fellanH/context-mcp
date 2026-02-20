import { z } from "zod";
import { captureAndIndex } from "../../capture/index.js";
import { indexEntry } from "../../index/index.js";
import { ok, ensureVaultExists } from "../helpers.js";

export const name = "submit_feedback";

export const description =
  "Report a bug, request a feature, or suggest an improvement. Feedback is stored in the vault and triaged by the development pipeline.";

export const inputSchema = {
  type: z.enum(["bug", "feature", "improvement"]).describe("Type of feedback"),
  title: z.string().describe("Short summary of the feedback"),
  body: z.string().describe("Detailed description"),
  severity: z.enum(["low", "medium", "high"]).optional().describe("Severity level (default: medium)"),
};

export async function handler({ type, title, body, severity }, ctx, { ensureIndexed }) {
  const { config } = ctx;
  const userId = ctx.userId !== undefined ? ctx.userId : undefined;

  const vaultErr = ensureVaultExists(config);
  if (vaultErr) return vaultErr;

  await ensureIndexed();

  const effectiveSeverity = severity || "medium";
  const entry = await captureAndIndex(
    ctx,
    {
      kind: "feedback",
      title,
      body,
      tags: [type, effectiveSeverity],
      source: "submit_feedback",
      meta: { feedback_type: type, severity: effectiveSeverity, status: "new" },
      userId,
    },
    indexEntry
  );

  const relPath = entry.filePath ? entry.filePath.replace(config.vaultDir + "/", "") : entry.filePath;
  return ok(`Feedback submitted: ${type} [${effectiveSeverity}] → ${relPath}\n  id: ${entry.id}\n  title: ${title}`);
}
