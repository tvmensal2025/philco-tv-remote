import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const { created } = JSON.parse(readFileSync('test-assets/e2e/openai-reels.json', 'utf8'));
mkdirSync('test-assets/e2e/reels', { recursive: true });
const results = [];

for (const item of created) {
  const approve = await fetch(`http://127.0.0.1:3000/api/reels/${item.reelId}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }),
  });
  const approveBody = await approve.json();
  const media = await fetch(`http://127.0.0.1:3000/api/media/${item.reelId}?download=1`);
  const ok = media.ok;
  const bytes = ok ? Buffer.from(await media.arrayBuffer()) : Buffer.alloc(0);
  if (ok) writeFileSync(`test-assets/e2e/reels/reel-${item.index}.mp4`, bytes);
  results.push({
    index: item.index,
    reelId: item.reelId,
    approveStatus: approve.status,
    approveError: approveBody.error ?? null,
    downloadOk: ok,
    bytes: bytes.length,
  });
}

writeFileSync('test-assets/e2e/openai-reels-download.json', JSON.stringify({ results }, null, 2));
console.log(JSON.stringify({ results }, null, 2));
if (results.some((item) => item.approveStatus >= 400 || !item.downloadOk || item.bytes < 10_000))
  process.exit(2);
