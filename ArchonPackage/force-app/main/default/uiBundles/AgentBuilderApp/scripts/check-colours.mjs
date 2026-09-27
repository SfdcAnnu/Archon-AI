// Fails the build if any source file hardcodes a colour.
//
// The app ships two themes over one token set (styles/global.css). That
// only holds while every colour comes from a token: a single `bg-[#fafafa]`
// is a white patch in the HUD theme that nobody sees until a customer
// does. 146 of them were removed to make the second theme possible; this
// keeps the count at zero without relying on anyone remembering.
//
// Allowed: token references (`var(--x)`), and a `var(--x, #fallback)` whose
// fallback only matters before the stylesheet loads.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const HEX = /(?:bg|text|border|from|to|ring|stroke|fill|shadow)-\[#[0-9a-fA-F]{3,8}(?:\/\d+)?\]|#[0-9a-fA-F]{6}\b/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name) && !p.endsWith('global.css')) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8');
  src.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(HEX)) {
      // a fallback inside var(--token, #hex) is fine — the token wins
      const before = line.slice(0, m.index);
      if (/var\(\s*--[\w-]+\s*,\s*$/.test(before)) continue;
      hits.push(`${relative(ROOT, file)}:${i + 1}  ${m[0]}`);
    }
  });
}

if (hits.length) {
  console.error(`\n${hits.length} hardcoded colour(s) — use a token from styles/global.css instead:\n`);
  for (const h of hits) console.error('  ' + h);
  console.error('');
  process.exit(1);
}
console.log('colours: all from tokens');
