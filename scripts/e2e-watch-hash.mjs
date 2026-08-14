import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const watchRoot = path.resolve('work/nvr-watch');
const files = [
  'C1/cam-01_20260813T134200_20260813T134300.mp4',
  'C2/cam-02_20260813T134200_20260813T134300.mp4',
  'C3/cam-03_20260813T134200_20260813T134300.mp4',
  'C4/cam-04_20260813T134200_20260813T134300.mp4',
];
const label = process.argv[2] || 'before';
const rows = files.map((rel) => {
  const full = path.join(watchRoot, rel);
  if (!existsSync(full)) return { rel, missing: true };
  const st = statSync(full);
  const hash = createHash('sha256').update(readFileSync(full)).digest('hex');
  return { rel, size: st.size, mtimeMs: st.mtimeMs, sha256: hash };
});
mkdirSync('work/validation', { recursive: true });
const out = path.join('work/validation', `watch-${label}.json`);
writeFileSync(out, JSON.stringify({ label, at: new Date().toISOString(), files: rows }, null, 2));
console.log(
  JSON.stringify(
    {
      label,
      files: rows.map((r) => ({
        rel: r.rel,
        size: r.size,
        sha256: r.sha256?.slice(0, 12),
        missing: r.missing,
      })),
    },
    null,
    2,
  ),
);
