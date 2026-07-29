// Computes the next publishable version and writes it into package.json
// (working tree only — not committed). major.minor come from package.json so
// they stay under manual control; the patch is auto-incremented past the
// highest patch already published on npm for that major.minor line.
//
// Usage: node scripts/ci-version.mjs
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const pkgPath = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const [major, minor] = pkg.version.split('.');
const prefix = `${major}.${minor}.`;

let published = [];
try {
  const raw = execSync(`npm view ${pkg.name} versions --json`, {
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString();
  const parsed = JSON.parse(raw);
  published = Array.isArray(parsed) ? parsed : [parsed];
} catch {
  // Package or version line not published yet — start at patch 0.
}

const patches = published
  .filter((v) => v.startsWith(prefix))
  .map((v) => Number.parseInt(v.slice(prefix.length), 10))
  .filter((n) => Number.isInteger(n));

const nextPatch = patches.length ? Math.max(...patches) + 1 : 0;
const next = `${prefix}${nextPatch}`;

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(next);
