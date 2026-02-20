# Outreach DM Templates — Week 6

Persona-specific DM templates for founder-led outreach. All templates use `{placeholders}` for personalization before sending.

**Rules:**
- 3-5 sentences max
- End with a question, not a pitch
- No real names or PII in this file
- Do not send these programmatically — they are drafts for manual use

---

## Template 1: Claude Code User

**Target:** Developer who posted about using Claude Code for development.
**Source code:** Claude
**Value-add:** Blog #8 — taxonomy design for long-term memory quality.
**Objection pre-load:** "Why not just use CLAUDE.md?" (static files lack semantic search, tagging, and selective retrieval)

> Hey {handle} — saw your post about {their_use_case} with Claude Code. One thing I kept running into was losing decisions and patterns between sessions, even with CLAUDE.md. I built Context Vault to fix that — it gives Claude persistent memory through MCP with structured kinds, tags, and hybrid search so the right context surfaces automatically. Wrote up how to design a taxonomy that actually scales: https://contextvault.dev/blog/designing-kinds-tags-folders-for-long-term-memory-quality — have you tried adding persistent memory to your Claude Code workflow?

**Personalization notes:**
- Replace `{handle}` with their X/Reddit/Discord handle
- Replace `{their_use_case}` with what they specifically posted about (e.g., "building a CLI tool," "refactoring a monorepo," "managing client projects")
- If they mentioned a specific pain point about context loss, reference it directly instead of the generic "losing decisions and patterns"

---

## Template 2: Cursor User

**Target:** Developer in the Cursor community discussing context loss between sessions.
**Source code:** Cursor
**Value-add:** Blog #4 — Context Vault + Cursor setup and best practices.
**Objection pre-load:** "Why not just use .cursorrules?" (static files break down as projects grow — no semantic search, no tagging, no cross-session retrieval)

> Hey {handle} — noticed your comment about {their_pain_point} in Cursor. I had the same issue — .cursorrules helped for stable stuff but fell apart once I had more than a handful of things to track across sessions. I built an MCP memory layer that plugs into Cursor and gives you searchable, tagged context that persists. Here's the setup guide: https://contextvault.dev/blog/context-vault-cursor-setup-best-practices — what does your current setup look like for keeping context between sessions?

**Personalization notes:**
- Replace `{handle}` with their forum/Discord/Reddit handle
- Replace `{their_pain_point}` with the specific issue they raised (e.g., "losing track of architecture decisions," "repeating the same instructions every session," "context window limits")
- If they mentioned a specific workaround they use (like .cursorrules or markdown files), acknowledge it before introducing CV

---

## Template 3: GitHub Stargazer

**Target:** Developer who starred the `context-vault` repo but hasn't registered for the hosted service.
**Source code:** GH
**Value-add:** Direct — they already know the repo. Focus on hosted setup ease.
**Objection pre-load:** "Seems complex to set up" (one MCP endpoint plus copy-paste config, under 5 minutes)

> Hey {handle} — thanks for starring Context Vault! Noticed you haven't set it up yet (no pressure). If the local install felt like too many steps, the hosted option is literally one endpoint URL and an API key — paste it into your MCP config and you're done in under 2 minutes. Free tier covers everything you'd need to evaluate it. What AI tool are you mainly using day-to-day?

**Personalization notes:**
- Replace `{handle}` with their GitHub username
- If they have a public repo or bio that reveals their stack (e.g., "Cursor user," "building with Claude"), tailor the last question toward that tool
- If they also opened an issue or discussion, reference it: "saw your question about {topic} too"
- Do not message users who starred more than 30 days ago without checking for recent activity first

---

## Usage Checklist

Before sending any template:

1. [ ] Verified the recipient is a real person (not a bot or org account)
2. [ ] Filled all `{placeholders}` with real, specific details from their post/profile
3. [ ] Confirmed the blog link is live and accessible
4. [ ] Checked that no PII is being committed to git (handles only, no emails)
5. [ ] Logged the outreach in `pipeline.md` with the correct source code
