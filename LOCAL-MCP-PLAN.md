# Local MCP Server — Architecture Plan

> Status: PLANNING — pick up and implement
> Author: architecture review 2026-02-21
> Scope: `packages/local` only

## Problem

The current local MCP server depends on `context-vault` being on the user's `PATH`
(i.e., globally installed with npm). Tool configs are written as:

```json
{ "command": "context-vault", "args": ["serve"] }
```

This breaks when:

- User installs via `npx` (not persistent on PATH)
- Global npm install path is not on the shell PATH at tool startup time
- User reinstalls or switches Node versions (native module mismatch)

Historically the server was a single self-contained JS file pointed to by absolute
path. That resilience needs to be restored and formalized.

The second problem is UX: switching between local and hosted modes requires knowing
two separate commands (`setup` vs `connect`) with no unified entry point.

## Goals

1. **Stable absolute-path local server** — `~/.context-mcp/server.mjs` is installed
   at setup time, referenced by absolute path in tool configs. No PATH dependency.

2. **Mode switching** — `context-vault switch local|hosted` reconfigures all
   detected AI tools with one command.

3. **Mode awareness** — Config and status output reflect which mode is active.

## Non-Goals

- Changing MCP tools or vault format
- Any hosted/backend changes
- Full esbuild bundling (native modules can't be bundled — see constraints)

---

## Phase 2 — Bundled Web UI (context-vault ui, fully offline)

> Added 2026-02-21. This is a separate workstream from phases 1/2 above, but
> shares the same package. Implement after the mode-switching work is stable.

### Problem

`context-vault ui` currently opens the **hosted Vercel app**
(`https://context-vault.com?local=PORT`) if the site is reachable.
`app-dist/` is not included in the npm package `files`, so a freshly
installed package has no local UI to serve. Users who want a fully
offline/airgapped experience are blocked.

### Goal

`context-vault ui` should serve a **bundled React app** from inside the
npm package — no network required, no Vercel dependency.

### What needs to change

| # | File | Change |
|---|---|---|
| 1 | `scripts/prepack.js` | After bundling core: build the React app and copy `dist/` → `app-dist/` |
| 2 | `package.json` | Add `"app-dist/"` to the `"files"` array |
| 3 | `bin/cli.js` — `ui` command | Remove the "prefer hosted if reachable" network check. Always open `http://localhost:{port}`. |

### prepack.js addition

Add after the existing core-bundling block:

```js
import { execSync } from "node:child_process";

// Build the web UI
const APP_ROOT = resolve(LOCAL_ROOT, "..", "..", "context-vault-app");
const APP_DIST_SRC = join(APP_ROOT, "dist");
const APP_DIST_DEST = join(LOCAL_ROOT, "app-dist");

execSync("npm run build", { cwd: APP_ROOT, stdio: "inherit" });
rmSync(APP_DIST_DEST, { recursive: true, force: true });
cpSync(APP_DIST_SRC, APP_DIST_DEST, { recursive: true });
console.log("[prepack] Bundled web UI into app-dist/");
```

> **Co-location assumption:** `context-vault-app` must be at
> `../../context-vault-app` relative to `packages/local/` (i.e. sibling
> repo at `/Users/admin/cv/context-vault-app`). This matches the current
> local dev layout. For CI, both repos must be cloned side-by-side.

### bin/cli.js — ui command

Remove the hosted-URL fallback block entirely. Replace with:

```js
// Always open local server — app-dist is bundled into the package
const url = `http://localhost:${port}`;
console.log(`Opening ${url}`);
execSync(`${open} ${url}`, { stdio: "ignore" });
```

The existing `local-server.js` already serves `app-dist/index.html`
correctly. No changes needed there.

Mode switching between local and hosted is handled inside the UI via
VaultModePopover — users can switch from within the running dashboard.

### Open questions (bundled UI)

1. **Bundle size**: current app bundle is ~615 kB (182 kB gzipped). Acceptable
   in an npm tarball, but consider code splitting before adding to the package.

2. **Version coupling**: when the React app changes, the local package must be
   re-published to deliver the updated UI. Track this in the release process.

3. **CI build**: the `prepack.js` script assumes both repos are co-located.
   Add a note to the release runbook that both repos must be present.

---

---

## Current File Map

```
packages/local/
  bin/cli.js              CLI — all user commands
  src/server/index.js     Local MCP stdio server (imports @context-vault/core)
  scripts/prepack.js      Copies @context-vault/core into node_modules before pack
  scripts/postinstall.js  Runs after npm install
  package.json            bundledDependencies: [@context-vault/core]
```

---

## Proposed Changes

### 1. Drop server file to `~/.context-mcp/` at postinstall

`scripts/postinstall.js` (currently runs after install) should:

1. Resolve the absolute path of `src/server/index.js` within the installed package
2. Copy it to `~/.context-mcp/server.mjs`
3. Write the resolved `node_modules` path alongside it so the server can find
   `@context-vault/core`, `better-sqlite3`, `sqlite-vec` at runtime

The server file itself stays as-is (`src/server/index.js`). No bundler needed —
the import paths just need to resolve correctly.

**Implementation approach:**

Option A (simplest): Write a thin launcher at `~/.context-mcp/server.mjs`:

```js
// Auto-generated by context-vault postinstall — do not edit
import "/absolute/path/to/packages/local/src/server/index.js";
```

This is a one-line file that re-exports the real server by absolute path.
When the package updates, postinstall rewrites it. Tool configs always point
to `~/.context-mcp/server.mjs` — stable across package updates.

Option B (full copy): Copy `src/server/index.js` + rewrite its import specifiers
to absolute paths using a simple string replace. More complex, but truly portable
if the npm package is later removed.

**Recommendation: Option A** for initial implementation. It's simple, idempotent,
and covers all user-facing failure modes. Option B can be revisited if users
uninstall the package and need standalone operation.

### 2. Update tool config writers to use absolute path

In `bin/cli.js`, `configureJsonTool` and `configureClaude` currently write:

```js
// installed package case:
{ command: "context-vault", args: ["serve"] }
```

Change to:

```js
{ command: "node", args: [join(HOME, ".context-mcp", "server.mjs")] }
```

This must be an absolute path (no `~` shorthand — AI tools don't expand it).
Use `homedir()` from `node:os` which is already imported.

The dev-clone case (non-installed) stays unchanged — it already uses absolute path:

```js
{ command: "node", args: [SERVER_PATH] }
```

### 3. Mode field in config

Add `mode: "local" | "hosted"` to `~/.context-mcp/config.json`.

`runSetup` writes `mode: "local"` before tool configuration.
`runConnect` writes `mode: "hosted"` before tool configuration.

No migration needed for existing installs — absence of `mode` implies `"local"`.

### 4. Switch command

New command: `context-vault switch [local|hosted]`

```
switch local:
  1. Postinstall: ensure ~/.context-mcp/server.mjs is up to date
  2. Set mode: "local" in config
  3. Detect tools, reconfigure each to use node ~/.context-mcp/server.mjs
  4. Print confirmation

switch hosted:
  1. Read apiKey from config (or prompt with --key flag)
  2. Validate against hosted API
  3. Set mode: "hosted" in config
  4. Detect tools, reconfigure each to use hosted HTTP endpoint
  5. Print confirmation
```

The switch command reuses existing `configureClaude`, `configureJsonTool`,
`configureClaudeHosted`, `configureJsonToolHosted` helpers — no duplication.

Add to help text and `main()` switch statement in `bin/cli.js`.

### 5. Status shows mode

`runStatus` gains one line after the version header:

```
Mode:      local  (node ~/.context-mcp/server.mjs)
```

or:

```
Mode:      hosted (api.context-vault.com · user@example.com)
```

Read `mode` from `resolveConfig()`. Add `mode` and `hostedUrl`/`email` fields
to the config resolution in `@context-vault/core/core/config.js`.

---

## Implementation Steps (for implementing agent)

Work in `packages/local/` unless noted. Commit to `main` as you go.

| #   | File                               | Change                                                                |
| --- | ---------------------------------- | --------------------------------------------------------------------- |
| 1   | `scripts/postinstall.js`           | Write `~/.context-mcp/server.mjs` launcher (Option A)                 |
| 2   | `bin/cli.js` — `configureJsonTool` | Use `node ~/.context-mcp/server.mjs` instead of `context-vault serve` |
| 3   | `bin/cli.js` — `configureClaude`   | Same — use absolute node path                                         |
| 4   | `bin/cli.js` — `configureCodex`    | Same — use absolute node path                                         |
| 5   | `bin/cli.js` — `runSetup`          | Write `mode: "local"` to config                                       |
| 6   | `bin/cli.js` — `runConnect`        | Write `mode: "hosted"` to config                                      |
| 7   | `bin/cli.js` — `runSwitch`         | Implement switch command (new function)                               |
| 8   | `bin/cli.js` — `main()`            | Add `switch` case                                                     |
| 9   | `bin/cli.js` — `showHelp`          | Add switch to help text                                               |
| 10  | `bin/cli.js` — `runStatus`         | Display mode line                                                     |

---

## Constraints

- **No esbuild/bundler** — native modules (`better-sqlite3`, `sqlite-vec`) are
  `.node` files that can't be inlined. Full bundling is not viable without also
  managing native addon placement. The launcher approach (Option A) avoids this.

- **No `~` in tool configs** — Always use `homedir()` to get absolute path.
  AI tools (Claude Desktop, Cursor, Cline) don't expand `~` in JSON configs.

- **Idempotent postinstall** — Writing the launcher is always safe to repeat.
  If `~/.context-mcp/server.mjs` already exists, overwrite it (it's generated).

- **`isInstalledPackage()` guard** — The dev-clone case must keep using the
  direct `SERVER_PATH` approach. Only installed-package mode uses the launcher.

- **Backward compat** — Existing installs using `context-vault serve` still
  work. The switch is only applied when users run `setup`, `connect`, or `switch`.
  No forced migration.

---

## File: `scripts/postinstall.js` — skeleton

```js
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SERVER_ABS = join(ROOT, "src", "server", "index.js");
const DATA_DIR = join(homedir(), ".context-mcp");
const LAUNCHER = join(DATA_DIR, "server.mjs");

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(LAUNCHER, `import "${SERVER_ABS}";\n`);
```

> NOTE: The existing `postinstall.js` may already do other work (embedding model
> warmup, etc). Read it first and add the launcher write without removing existing
> logic.

---

## Open Questions

1. **Option A vs B** — Option A (launcher) requires the npm package to remain
   installed. If users `npm uninstall -g context-vault`, the launcher breaks.
   Option B (full copy with rewritten imports) would survive uninstall.
   Decide based on whether standalone-after-uninstall is a real user scenario.

2. **Setup prompt** — Should `setup` proactively ask "local or hosted?" upfront,
   or only add the `switch` command for post-setup mode changes? Starting with
   `switch`-only is less disruptive to the existing setup flow.

3. **Codex** — The Codex tool (`configureCodex`) may support a different config
   format. Verify that `node ~/.context-mcp/server.mjs` works as an MCP server
   command in Codex before finalizing.
