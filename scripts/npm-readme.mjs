// Trims README.md for npm publish (working tree only — not committed, same
// pattern as ci-version.mjs). npm's package page is standalone: it doesn't
// need "## Status" (feature-by-feature prose that belongs to the ongoing
// GitHub project, not a package landing page) or the "Publish to GitHub
// Pages" note under Documentation (instructions for maintaining *this* repo,
// not for a consumer of the package). The GitHub-browsed README keeps both.
//
// Usage: node scripts/npm-readme.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const readmePath = new URL('../README.md', import.meta.url);
const eol = /\r\n/.test(readFileSync(readmePath, 'utf8')) ? '\r\n' : '\n';
let readme = readFileSync(readmePath, 'utf8');

/** Removes a top-level `## heading` section (up to, not including, the next `## `). */
function stripSection(md, heading) {
  const marker = `${eol}${heading}${eol}`;
  const start = md.indexOf(marker);
  if (start === -1) throw new Error(`Section not found: ${heading}`);
  const next = md.indexOf(`${eol}## `, start + marker.length);
  if (next === -1) throw new Error(`No section follows: ${heading}`);
  return md.slice(0, start) + md.slice(next);
}

/** Removes one paragraph, identified by its opening line, up to the next top-level heading. */
function stripParagraph(md, opening) {
  const marker = `${eol}${opening}`;
  const start = md.indexOf(marker);
  if (start === -1) throw new Error(`Paragraph not found: ${opening}`);
  const next = md.indexOf(`${eol}## `, start + marker.length);
  if (next === -1) throw new Error(`No heading follows paragraph: ${opening}`);
  return md.slice(0, start) + md.slice(next);
}

readme = stripSection(readme, '## Status');
readme = stripParagraph(readme, '**Publish to GitHub Pages:**');

writeFileSync(readmePath, readme);
console.log('README trimmed for npm publish (Status + Publish-to-Pages removed)');
