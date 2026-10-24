// Sanity checks on the production build in dist/.
import { readFileSync, readdirSync } from 'node:fs';

const base = process.env.BASE_PATH ?? '/mach1-analyzer/';
const html = readFileSync('dist/index.html', 'utf8');
const errors = [];

if (!html.includes('http-equiv="Content-Security-Policy"')) errors.push('Content-Security-Policy meta tag is missing.');
if (!/connect-src 'self'/.test(html)) errors.push("CSP must restrict connect-src to 'self'.");
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:'));
for (const u of refs) {
  if (/^https?:\/\//.test(u)) errors.push(`index.html loads an external resource: ${u}`);
  else if (!u.startsWith(base)) errors.push(`Asset path ${u} does not start with ${base}; the site would break on GitHub Pages.`);
}
const files = readdirSync('dist', { recursive: true }).map(String);
const data = files.filter((f) => /\.txt$/i.test(f));
if (data.length) errors.push(`TXT files found in the published site: ${data.join(', ')}`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: site built for ${base}, CSP present, ${refs.length} local asset reference(s), no TXT data published.`);
