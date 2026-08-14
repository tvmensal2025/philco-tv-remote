import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

function run(command, args, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...extra });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const root = path.resolve('work/outbox-live');
rmSync(root, { recursive: true, force: true });
const outboxDir = path.join(root, 'outbox');
const uploadedDir = path.join(root, 'uploaded');
const failedDir = path.join(root, 'failed');
mkdirSync(outboxDir, { recursive: true });
mkdirSync(uploadedDir, { recursive: true });
mkdirSync(failedDir, { recursive: true });
const sample = existsSync('test-assets/e2e/cam-01.mp4')
  ? 'test-assets/e2e/cam-01.mp4'
  : 'test-assets/e2e/cam-04.mp4';
const fileName = 'cam-01_20260814T180000_20260814T180100.mp4';
const outboxFile = path.join(outboxDir, fileName);
copyFileSync(sample, outboxFile);
writeFileSync(
  path.join(root, 'outbox.json'),
  JSON.stringify(
    {
      apiUrl: 'http://127.0.0.1:3000',
      ingestKey: env.INGEST_API_KEY,
      restaurantId: context.restaurant.id,
      sourceMode: 'outbox',
      outbox: outboxDir,
      uploaded: uploadedDir,
      failed: failedDir,
      dbPath: path.join(root, 'outbox.sqlite'),
      fileStableSeconds: 1,
      fileStableChecks: 3,
      moveOnSuccess: true,
      moveOnFailure: true,
      cameras: { 'cam-01': 1 },
    },
    null,
    2,
  ),
);
let result = { code: 1, stdout: '', stderr: '' };
for (let attempt = 0; attempt < 4; attempt++) {
  result = await run('node', ['apps/uploader/src/index.mjs', '--once'], {
    env: {
      ...process.env,
      CENAPRONTA_UPLOADER_CONFIG: path.join(root, 'outbox.json'),
      FILE_STABLE_SECONDS: '1',
      FILE_STABLE_CHECKS: '2',
    },
  });
  const uploadedNow = existsSync(uploadedDir)
    ? readdirSync(uploadedDir).filter((name) => name.toLowerCase().endsWith('.mp4'))
    : [];
  if (uploadedNow.length) break;
  await new Promise((resolve) => setTimeout(resolve, 4000));
}
const uploadedFiles = existsSync(uploadedDir)
  ? readdirSync(uploadedDir).filter((name) => name.toLowerCase().endsWith('.mp4'))
  : [];
const failedFiles = existsSync(failedDir)
  ? readdirSync(failedDir).filter((name) => name.toLowerCase().endsWith('.mp4'))
  : [];
const moved = uploadedFiles.length > 0;
const stayed = existsSync(outboxFile);
const report = {
  exit: result.code,
  movedToUploaded: moved,
  uploadedFiles,
  failedFiles,
  remainedInOutbox: stayed,
  log: `${result.stdout}\n${result.stderr}`.slice(-2000),
  pass: result.code === 0 && moved && !stayed,
};
writeFileSync('work/revideo-evidence/outbox-live.json', JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      pass: report.pass,
      exit: report.exit,
      movedToUploaded: moved,
      remainedInOutbox: stayed,
      tail: report.log.slice(-400),
    },
    null,
    2,
  ),
);
if (!report.pass) process.exit(2);
