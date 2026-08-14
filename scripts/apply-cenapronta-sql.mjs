import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] ?? 'supabase/migrations/0009_cenapronta_layout.sql';
const sql = await readFile(path.join(root, file), 'utf8');
const meta = JSON.parse(await readFile(path.join(root, '.reelops-supabase.tmp.json'), 'utf8'));
const ref = meta.ref;
if (!ref) throw new Error('CENAPRONTA project ref ausente em .reelops-supabase.tmp.json');

async function accessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const mcp = JSON.parse(
    await readFile(path.join(process.env.USERPROFILE ?? '', '.cursor', 'mcp.json'), 'utf8'),
  );
  const token =
    mcp?.mcpServers?.supabase?.env?.SUPABASE_ACCESS_TOKEN ??
    mcp?.mcpServers?.['user-supabase']?.env?.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN ausente');
  return token;
}

const token = await accessToken();
const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});
const body = await response.text();
if (!response.ok) {
  console.error(`Falha ${response.status} ao aplicar ${file}`);
  console.error(body.slice(0, 1500));
  process.exit(1);
}

const recorded = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    query: `insert into public._reelops_migrations(name) values ('${path.basename(file)}') on conflict (name) do nothing`,
  }),
});
if (!recorded.ok) {
  console.error(
    `Migration aplicada, mas o registro em _reelops_migrations falhou: ${recorded.status}`,
  );
  process.exit(1);
}
console.log(`Aplicado ${file} no projeto CENAPRONTA.`);
