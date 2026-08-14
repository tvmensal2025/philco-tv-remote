import { readFileSync } from 'node:fs';

const moment = JSON.parse(readFileSync('test-assets/e2e/moment.json', 'utf8'));
const reelId = moment.body.reel.id;
const res = await fetch(`http://127.0.0.1:3000/api/reels/${reelId}/action`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'retry' }),
});
const body = await res.json();
console.log(JSON.stringify({ status: res.status, body }));
