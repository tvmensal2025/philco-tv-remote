import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function patch(file, find, replace, label) {
  const source = readFileSync(file, 'utf8');
  if (source.includes(replace.trim().slice(0, 40)) && source.includes('already') === false) {
    if (
      source.includes(replace) ||
      (label === 'single-process' && source.includes('process.platform !== "win32"'))
    ) {
      console.log(`${label}: already applied`);
      return;
    }
  }
  if (label === 'single-process' && source.includes('process.platform !== "win32"')) {
    console.log('single-process: already applied');
    return;
  }
  if (label === 'mkdir' && source.includes('mkdirSync(this.jobFolder')) {
    console.log('mkdir: already applied');
    return;
  }
  if (!source.includes(find)) {
    console.error(`${label}: target not found in ${file}`);
    process.exit(1);
  }
  writeFileSync(file, source.replace(find, replace));
  console.log(`${label}: applied`);
}

patch(
  path.join('node_modules', '@revideo', 'renderer', 'lib', 'server', 'render-video.js'),
  "const args = settings.puppeteer?.args ?? [];\n    args.includes('--single-process') || args.push('--single-process');",
  "const args = settings.puppeteer?.args ?? [];\n    if (process.platform !== \"win32\") {\n      args.includes('--single-process') || args.push('--single-process');\n    }",
  'single-process',
);

const exporter = path.join(
  'node_modules',
  '@revideo',
  'ffmpeg',
  'dist',
  'ffmpeg-exporter-server.js',
);
const exporterSource = readFileSync(exporter, 'utf8');
if (exporterSource.includes('mkdirSync(this.jobFolder')) {
  console.log('mkdir: already applied');
} else if (!exporterSource.includes('this.jobFolder = path.join(os.tmpdir()')) {
  console.error('mkdir: jobFolder assignment not found');
  process.exit(1);
} else {
  const next = exporterSource
    .replace(
      'const os = require("os");\n',
      'const os = require("os");\nconst fs = require("fs");\n',
    )
    .replace(
      'this.jobFolder = path.join(os.tmpdir(), `revideo-${this.settings.name}-${settings.hiddenFolderId}`);',
      'this.jobFolder = path.join(os.tmpdir(), `revideo-${this.settings.name}-${settings.hiddenFolderId}`);\n        fs.mkdirSync(this.jobFolder, { recursive: true });',
    );
  if (next === exporterSource) {
    console.error('mkdir: replace failed');
    process.exit(1);
  }
  writeFileSync(exporter, next);
  console.log('mkdir: applied');
}
