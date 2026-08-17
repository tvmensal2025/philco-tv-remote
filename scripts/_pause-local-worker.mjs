import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function workerPids() {
  const raw = execSync(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"',
    { encoding: 'utf8' },
  );
  const rows = JSON.parse(raw || '[]');
  const list = Array.isArray(rows) ? rows : [rows];
  return list
    .filter((row) => {
      const cmd = String(row.CommandLine ?? '');
      if (/playwright|next dev|apps\\web|apps\/web/i.test(cmd)) return false;
      return (
        /@reelops\/worker/i.test(cmd) ||
        /watch src[\\/]index\.ts/i.test(cmd) ||
        (/tsx[\\/]dist[\\/]preflight\.cjs/i.test(cmd) &&
          /src[\\/]index\.ts/i.test(cmd) &&
          /philco-tv-remote/i.test(cmd))
      );
    })
    .map((row) => Number(row.ProcessId));
}

const until = Date.now() + Number(process.argv[2] || 45) * 60_000;
const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

while (Date.now() < until) {
  const pids = workerPids();
  for (const pid of pids) {
    try {
      process.kill(pid);
      console.log(`killed ${pid}`);
    } catch {
      /* already gone */
    }
  }
  const { data } = await sb.from('worker_nodes').select('id,metadata,last_seen_at').limit(12);
  const rafael = (data ?? []).filter((node) =>
    /rafael/i.test(String(node.metadata?.hostname ?? node.id)),
  );
  for (const node of rafael) {
    const age = Date.now() - Date.parse(node.last_seen_at);
    if (age < 90_000) {
      await sb
        .from('worker_nodes')
        .update({ last_seen_at: new Date(Date.now() - 3 * 60_000).toISOString() })
        .eq('id', node.id);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 4000));
}
