#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const files = [
  'package.json',
  'packages/core/package.json',
  'packages/local/package.json',
];

function parseVersion(v) {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Invalid version: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function bump(current, type) {
  const [major, minor, patch] = parseVersion(current);
  switch (type) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default:
      // Treat as explicit version
      parseVersion(type); // validate
      return type;
  }
}

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/bump-version.mjs <patch|minor|major|x.y.z>');
  process.exit(1);
}

// Read current version from root package.json
const rootPkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const oldVersion = rootPkg.version;
const newVersion = bump(oldVersion, arg);

console.log(`Bumping ${oldVersion} → ${newVersion}\n`);

for (const file of files) {
  const fullPath = resolve(root, file);
  const pkg = JSON.parse(readFileSync(fullPath, 'utf8'));
  pkg.version = newVersion;

  // Update @context-vault/core dependency in packages/local
  if (pkg.dependencies?.['@context-vault/core']) {
    pkg.dependencies['@context-vault/core'] = `^${newVersion}`;
  }

  writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`  Updated ${file}`);
}

console.log(`
Done! Next steps:

  git add package.json packages/core/package.json packages/local/package.json CHANGELOG.md
  git commit -m "v${newVersion}"
  git tag v${newVersion}
  git push origin main --tags
`);
