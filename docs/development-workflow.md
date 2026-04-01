# Development Workflow

How to make changes to context-vault, release them, and verify they work as a real user would experience.

## Prerequisites

- npm account with publish access to `context-vault` and `@context-vault/core`
- GitHub CLI (`gh`) authenticated with push access to `fellanH/context-vault`
- Node.js 22+ (native `node:sqlite` required)

## Monorepo structure

```
mcp/
├── packages/
│   ├── core/          # @context-vault/core (shared library, no CLI)
│   └── local/         # context-vault (CLI + MCP server, depends on core)
├── scripts/
│   └── release.mjs    # Automated release script
├── test/              # Unit, integration, and E2E tests
└── CHANGELOG.md       # Must be updated before every release
```

`local` depends on `core` via npm workspace. After modifying core, run `npm run build --workspace packages/core` before building local, or use `npm run build` from the monorepo root (builds core first, then local).

## Development cycle

### 1. Make changes

Edit source in `packages/core/src/` and/or `packages/local/src/`.

### 2. Build

```bash
cd mcp
npm run build     # builds core → local in order
```

### 3. Typecheck

```bash
npx tsc --noEmit 2>&1 | head -20
```

If `local` can't see new types from `core`, the workspace link may be stale. Run `npm install` from the monorepo root to re-resolve, then rebuild core before local.

### 4. Test

```bash
npm test          # runs vitest across all packages
```

All tests must pass before release. The release script runs them again as a gate.

### 5. Update CHANGELOG.md

Add a section for the new version **before** running the release script. The script checks for the version header and aborts if missing.

```markdown
## [x.y.z] — YYYY-MM-DD

### Fixed / Added / Changed
- Description of change
```

### 6. Release

```bash
node scripts/release.mjs patch   # x.y.z → x.y.(z+1)
node scripts/release.mjs minor   # x.y.z → x.(y+1).0
node scripts/release.mjs major   # x.y.z → (x+1).0.0
```

The script handles everything:
1. Bumps version in `package.json` (root + core + local)
2. Updates core dependency version in local's `package.json`
3. Runs `npm test`
4. Runs `npm run build`
5. Publishes `@context-vault/core` then `context-vault` to npm
6. Commits, tags (`vx.y.z`), pushes to `origin/main`
7. Creates a GitHub release with changelog notes

**Requires clean working tree.** Commit or stash all changes first.

## Post-release verification

After publishing, verify the release works as a real user would experience it. This catches packaging issues, missing files, and broken install paths.

### Clean local state

```bash
# Kill any running instances
pkill -f "context-vault serve" 2>/dev/null
pkill -f "context-vault-daemon" 2>/dev/null

# Remove ALL global installs (check both homebrew and nvm paths)
npm uninstall -g context-vault
# If nvm is in use, also uninstall from the nvm-managed node:
npm uninstall -g context-vault --prefix $(dirname $(dirname $(which node)))

# Verify fully removed
which context-vault  # should return "not found"
```

### Install as a user

The marketing site (`context-vault.com`) recommends `npx context-vault setup` as the primary install path. This is what most users run.

**How the install paths work:**

`setup` detects whether it's running via npx or a global install and writes MCP configs accordingly:

| Install method | MCP config written | Server launch |
|---|---|---|
| `npx context-vault setup` | `{ command: "npx", args: ["-y", "context-vault", "serve"] }` | npx re-downloads on each spawn (cached) |
| `npm i -g` + `context-vault setup` | `{ command: "context-vault", args: ["serve"] }` | Direct binary, faster startup |

Both paths are valid. The npx path is self-updating (always fetches latest) but adds ~1-2s latency on server spawn. The global install is faster but requires manual `npm update -g context-vault` for updates (or the auto-update daemon handles it).

**Option A: npx (matches marketing site)**

```bash
npx context-vault@latest setup
```

**Option B: Global install (recommended for post-release verification)**

```bash
npm install -g context-vault@latest
context-vault --version   # verify version matches release
context-vault setup       # if not already set up
```

Use Option A for post-release verification since it exercises the full user flow: npx download, global install prompt, tool config writes with direct binary paths.

**What setup does when invoked via npx:**

1. Detects npx environment (`isNpx()`)
2. Checks if global install exists (`hasGlobalInstall()` via `npm prefix -g`)
3. If no global install: prompts to install globally (auto-accepts in `--yes` mode)
4. Runs `npm install -g context-vault@<version>`
5. All tool configs use `{ command: "context-vault" }` (direct binary, not npx)

**Important:** `hasGlobalInstall()` uses `npm prefix -g` to find the global binary, not `which`. Inside npx, `which context-vault` returns the npx cache path, which would cause false negatives.

### Verify tool configs use direct binary

After setup, all tool configs should reference `context-vault` directly (not `npx`):

```bash
# Claude Code
claude mcp list | grep context-vault

# JSON configs (Cursor, Claude Desktop, Windsurf)
python3 -c "import json; d=json.load(open('$HOME/.cursor/mcp.json')); print(d['mcpServers']['context-vault']['command'])"
# Expected: "context-vault" (NOT "npx")
```

### Verify server startup

```bash
context-vault serve --http --port 13377 &
CV_PID=$!

for i in $(seq 1 5); do
  sleep 2
  ps -p $CV_PID -o pid,rss,%cpu,%mem 2>/dev/null
done

kill $CV_PID
```

Expected behavior:
- RSS should stabilize under 400 MB (no embedding model loaded on startup)
- CPU should spike briefly during FTS reindex, then settle to 0%
- Log should show "Deferred N embeddings" (not "Loading embedding model")

### Verify tool functionality

Start the server, then in a Claude Code session:
1. `context_status` -- should show vault info and version
2. `save_context` with a test entry
3. `get_context` with a matching query (this triggers lazy embedding)

## Troubleshooting

### "skipEmbeddings" type error on build

Core was rebuilt but local still sees the old `.d.ts`. Run `npm install` from monorepo root to re-link, then `npm run build`.

### Release script says "Working tree is dirty"

Untracked files count as dirty. Either commit them, add to `.gitignore`, or stash.

### npx serves a stale version

npx caches packages. Force a fresh fetch:

```bash
npx context-vault@latest --version
```

Or clear the npx cache:

```bash
rm -rf ~/.npm/_npx/
```

### LaunchAgent has stale paths after install

The daemon's self-heal mechanism detects and rewrites the plist on startup. If it fails, manually reload:

```bash
launchctl unload ~/Library/LaunchAgents/com.context-vault.daemon.plist
launchctl load -w ~/Library/LaunchAgents/com.context-vault.daemon.plist
```
