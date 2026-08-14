import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}
const dump = JSON.parse(readFileSync('work/validation/casa-decision.json', 'utf8'));
const ids = [...new Set(dump.scenes.map((scene) => scene.cameraId))];
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await sb.from('cameras').select('id,position').in('id', ids);
const recordingCams = [...new Set((dump.recordings ?? []).map((row) => row.camera_id))];
const report = {
  AUTH_BYPASS: env.AUTH_BYPASS ?? 'MISSING',
  ALLOW_AUTH_BYPASS_IN_PRODUCTION: env.ALLOW_AUTH_BYPASS_IN_PRODUCTION ?? 'MISSING',
  cameraQueryError: error?.message ?? null,
  camerasFound: data ?? [],
  decisionCameraIds: ids,
  recordingCameraIds: recordingCams,
  idsInRecordings: ids.every(
    (id) => recordingCams.includes(id) || (data ?? []).some((row) => row.id === id),
  ),
  idsInCamerasTable: ids.every((id) => (data ?? []).some((row) => row.id === id)),
};
writeFileSync('work/validation/cameras-check.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
