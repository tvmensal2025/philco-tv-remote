import { spawn } from 'node:child_process';
import { loadRootEnv } from './load-root-env.mjs';

const args = process.argv.slice(2);
const lifecycle = process.env.npm_lifecycle_event;
const targetsWorkspace =
  args.includes('-w') || args.includes('--workspace') || args.includes('--workspaces');
if (lifecycle && args[0] === 'run' && args[1] === lifecycle && !targetsWorkspace) {
  console.error(
    `run-with-env.mjs: refusing to recurse into \`npm run ${lifecycle}\`. Point the wrapper at turbo or a workspace script.`,
  );
  process.exit(1);
}

loadRootEnv(process.cwd(), { override: true });
const childEnv = { ...process.env };
const npmCli = process.env.npm_execpath;
const child = npmCli
  ? spawn(process.execPath, [npmCli, ...args], { env: childEnv, stdio: 'inherit', shell: false })
  : spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      env: childEnv,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
