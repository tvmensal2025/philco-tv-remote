import { readFileSync } from 'node:fs';

const cookie = `reelops-tenant=${JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8')).tenant.id}`;
const ids = ['09e221e8-fd84-4e32-a420-90612f4a0f85', '506af041-a4d9-45ae-a38e-fb9aa5891cdc'];
for (const id of ids) {
  const res = await fetch(`http://127.0.0.1:3000/api/reels/${id}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ action: 'retry' }),
  });
  console.log(JSON.stringify({ id: id.slice(0, 8), status: res.status, body: await res.json() }));
}
