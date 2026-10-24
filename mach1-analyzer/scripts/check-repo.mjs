// Fails the build if files that look like real Mach-1 data are tracked in git.
// Only synthetic examples (examples/synthetic-data/ and public/synthetic-example.zip) are allowed.
import { execSync } from 'node:child_process';

const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const allowed = (p) => p.startsWith('examples/synthetic-data/') || p === 'public/synthetic-example.zip';
const suspicious = tracked.filter(
  (p) => !allowed(p) && (/\.txt$/i.test(p) || /\.zip$/i.test(p) || /\.xlsx?$/i.test(p) || p.startsWith('private-data/')),
);
if (suspicious.length) {
  console.error('These files look like experimental data and must not be in the public repository:');
  for (const p of suspicious) console.error('  ' + p);
  console.error('Delete them from the repository (see docs/PUBLISHING.md, "If data were uploaded by mistake").');
  process.exit(1);
}
console.log(`OK: ${tracked.length} tracked files, no experimental data found.`);
