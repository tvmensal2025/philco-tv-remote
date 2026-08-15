import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets', 'fx', 'factory');
mkdirSync(outDir, { recursive: true });

const vp9 = [
  '-c:v',
  'libvpx-vp9',
  '-pix_fmt',
  'yuva420p',
  '-auto-alt-ref',
  '0',
  '-crf',
  '32',
  '-b:v',
  '0',
  '-an',
  '-y',
];
const vp9Opaque = [
  '-c:v',
  'libvpx-vp9',
  '-pix_fmt',
  'yuv420p',
  '-crf',
  '32',
  '-b:v',
  '0',
  '-an',
  '-y',
];

const jobs = [
  {
    file: 'join-flash.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      'color=c=0xFFFFFF@0.82:s=1080x1920:d=0.5:r=30,format=yuva420p,fade=t=in:st=0:d=0.1:alpha=1,fade=t=out:st=0.26:d=0.24:alpha=1',
      ...vp9,
    ],
  },
  {
    file: 'join-blur-pulse.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      'color=c=0xFFFFFF@0.5:s=1080x1920:d=0.7:r=30,format=yuva420p,gblur=sigma=32,fade=t=in:st=0:d=0.14:alpha=1,fade=t=out:st=0.38:d=0.32:alpha=1',
      ...vp9,
    ],
  },
  {
    file: 'join-wipe-up.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      "color=white:s=1080x1920:d=0.7:r=30,format=rgba,geq=r=255:g=255:b=255:a='if(gt(Y\\,H-H*min(1\\,T/0.38))\\,200\\,0)',gblur=sigma=18,format=yuva420p,fade=t=out:st=0.46:d=0.24:alpha=1",
      ...vp9,
    ],
  },
  {
    file: 'join-wipe-side.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      "color=white:s=1080x1920:d=0.7:r=30,format=rgba,geq=r=255:g=255:b=255:a='if(lt(X\\,W*min(1\\,T/0.4))\\,190\\,0)',gblur=sigma=14,format=yuva420p,fade=t=out:st=0.46:d=0.24:alpha=1",
      ...vp9,
    ],
  },
  {
    file: 'join-leak-warm.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      "color=black@0:s=1080x1920:d=0.8:r=30,format=rgba,geq=r=255:g=140:b=50:a='200*exp(-(pow(X-W*0.78\\,2)+pow(Y-H*0.12\\,2))/220000)*min(1\\,T/0.18)*max(0\\,1-(T-0.42)/0.38)',gblur=sigma=46,format=yuva420p",
      ...vp9,
    ],
  },
  {
    file: 'join-burn.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      "color=black@0:s=1080x1920:d=0.75:r=30,format=rgba,geq=r=255:g=90:b=30:a='170*exp(-(pow(Y-H*0.08\\,2))/90000)*min(1\\,T/0.12)*max(0\\,1-(T-0.4)/0.35)+140*exp(-(pow(Y-H*0.92\\,2))/110000)*min(1\\,T/0.12)*max(0\\,1-(T-0.4)/0.35)',gblur=sigma=36,format=yuva420p",
      ...vp9,
    ],
  },
  {
    file: 'join-smear.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      'color=c=0xFFFFFF@0.38:s=1080x1920:d=0.55:r=30,format=yuva420p,gblur=sigma=10:sigmaV=70,fade=t=in:st=0:d=0.08:alpha=1,fade=t=out:st=0.28:d=0.27:alpha=1',
      ...vp9,
    ],
  },
  {
    file: 'lens-flare.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      "color=black:s=1080x1920:d=0.85:r=30,format=gbrp,geq=r='min(255\\,255*exp(-(pow(X-W*0.5\\,2)+pow(Y-H*0.32\\,2))/90000)+210*exp(-(pow(X-W*0.58\\,2)+pow(Y-H*0.3\\,2))/18000))':g='min(255\\,220*exp(-(pow(X-W*0.5\\,2)+pow(Y-H*0.32\\,2))/90000)+180*exp(-(pow(X-W*0.58\\,2)+pow(Y-H*0.3\\,2))/18000))':b='min(255\\,160*exp(-(pow(X-W*0.5\\,2)+pow(Y-H*0.32\\,2))/110000)+90*exp(-(pow(X-W*0.58\\,2)+pow(Y-H*0.3\\,2))/18000))',gblur=sigma=22,fade=t=in:st=0:d=0.12,fade=t=out:st=0.5:d=0.35,format=yuv420p",
      ...vp9Opaque,
    ],
  },
  {
    file: 'lens-cool.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      "color=black@0:s=1080x1920:d=1.1:r=30,format=rgba,geq=r=80:g=170:b=255:a='70*pow((hypot(X-W/2\\,Y-H/2)/(hypot(W/2\\,H/2)))\\,2.2)*min(1\\,T/0.2)*max(0\\,1-(T-0.7)/0.4)',gblur=sigma=28,format=yuva420p",
      ...vp9,
    ],
  },
  {
    file: 'film-grain.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      'color=c=0x808080@0.18:s=1080x1920:d=1.2:r=30,format=yuva420p,noise=alls=14:allf=t,fade=t=in:st=0:d=0.12:alpha=1,fade=t=out:st=0.95:d=0.25:alpha=1',
      ...vp9,
    ],
  },
  {
    file: 'join-dip-white.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      'color=c=0xFFFFFF@0.9:s=1080x1920:d=0.55:r=30,format=yuva420p,fade=t=in:st=0:d=0.18:alpha=1,fade=t=out:st=0.28:d=0.27:alpha=1',
      ...vp9,
    ],
  },
  {
    file: 'join-zoom.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      'color=c=0xFFFFFF@0.35:s=1080x1920:d=0.6:r=30,format=yuva420p,gblur=sigma=8,zoompan=z=1.08:d=18:s=1080x1920,fade=t=out:st=0.32:d=0.28:alpha=1',
      ...vp9,
    ],
  },
  {
    file: 'join-push.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      "color=white:s=1080x1920:d=0.55:r=30,format=rgba,geq=r=255:g=255:b=255:a='if(gt(X\\,W-W*min(1\\,T/0.28))\\,180\\,0)',gblur=sigma=12,format=yuva420p,fade=t=out:st=0.32:d=0.23:alpha=1",
      ...vp9,
    ],
  },
  {
    file: 'join-slide.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      "color=white:s=1080x1920:d=0.6:r=30,format=rgba,geq=r=240:g=240:b=255:a='if(lt(Y\\,H*min(1\\,T/0.3))\\,160\\,0)',gblur=sigma=10,format=yuva420p,fade=t=out:st=0.36:d=0.24:alpha=1",
      ...vp9,
    ],
  },
  {
    file: 'join-whip.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      'color=c=0xFFFFFF@0.45:s=1080x1920:d=0.4:r=30,format=yuva420p,gblur=sigma=4:sigmaV=80,fade=t=in:st=0:d=0.05:alpha=1,fade=t=out:st=0.18:d=0.22:alpha=1',
      ...vp9,
    ],
  },
  {
    file: 'join-spin.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      'color=c=0xFFFFFF@0.28:s=1080x1920:d=0.55:r=30,format=yuva420p,rotate=a=6.2832*t/0.45:c=none,fade=t=out:st=0.3:d=0.25:alpha=1',
      ...vp9,
    ],
  },
  {
    file: 'join-shake.webm',
    args: [
      '-f',
      'lavfi',
      '-i',
      'color=c=0xFFFFFF@0.22:s=1080x1920:d=0.35:r=30,format=yuva420p,crop=iw-20:ih-20:10:10,fade=t=out:st=0.18:d=0.17:alpha=1',
      ...vp9,
    ],
  },
];

const catalog = {
  assets: [
    {
      id: 'factory-flash',
      pack: 'factory-alpha',
      file: 'factory/join-flash.webm',
      role: 'join',
      blend: 'alpha',
      durationMs: 500,
      tags: ['flash', 'cut', 'high-energy'],
    },
    {
      id: 'factory-blur-pulse',
      pack: 'factory-alpha',
      file: 'factory/join-blur-pulse.webm',
      role: 'join',
      blend: 'alpha',
      durationMs: 700,
      tags: ['blur', 'pulse', 'soft'],
    },
    {
      id: 'factory-wipe-up',
      pack: 'factory-alpha',
      file: 'factory/join-wipe-up.webm',
      role: 'join',
      blend: 'alpha',
      durationMs: 700,
      tags: ['wipe', 'up'],
    },
    {
      id: 'factory-wipe-side',
      pack: 'factory-alpha',
      file: 'factory/join-wipe-side.webm',
      role: 'join',
      blend: 'alpha',
      durationMs: 700,
      tags: ['wipe', 'side'],
    },
    {
      id: 'factory-leak-warm',
      pack: 'factory-alpha',
      file: 'factory/join-leak-warm.webm',
      role: 'join',
      blend: 'alpha',
      durationMs: 800,
      tags: ['leak', 'warm', 'light'],
    },
    {
      id: 'factory-burn',
      pack: 'factory-alpha',
      file: 'factory/join-burn.webm',
      role: 'join',
      blend: 'alpha',
      durationMs: 750,
      tags: ['burn', 'film', 'edge'],
    },
    {
      id: 'factory-smear',
      pack: 'factory-alpha',
      file: 'factory/join-smear.webm',
      role: 'join',
      blend: 'alpha',
      durationMs: 550,
      tags: ['smear', 'motion-blur', 'fast'],
    },
    {
      id: 'factory-lens-flare',
      pack: 'factory-alpha',
      file: 'factory/lens-flare.webm',
      role: 'lens',
      blend: 'screen',
      durationMs: 850,
      tags: ['lens', 'flare', 'screen'],
    },
    {
      id: 'factory-lens-cool',
      pack: 'factory-alpha',
      file: 'factory/lens-cool.webm',
      role: 'lens',
      blend: 'alpha',
      durationMs: 1100,
      tags: ['lens', 'filter', 'cool'],
    },
    {
      id: 'factory-film-grain',
      pack: 'factory-alpha',
      file: 'factory/film-grain.webm',
      role: 'film',
      blend: 'alpha',
      durationMs: 1200,
      tags: ['film', 'grain'],
    },
    {
      id: 'factory-dip-white',
      pack: 'factory-alpha',
      file: 'factory/join-dip-white.webm',
      role: 'join',
      blend: 'alpha',
      durationMs: 550,
      tags: ['dip', 'white', 'flash'],
    },
    {
      id: 'factory-zoom',
      pack: 'factory-alpha',
      file: 'factory/join-zoom.webm',
      role: 'join',
      blend: 'alpha',
      durationMs: 600,
      tags: ['zoom', 'transition'],
    },
    {
      id: 'factory-push',
      pack: 'factory-alpha',
      file: 'factory/join-push.webm',
      role: 'join',
      blend: 'alpha',
      durationMs: 550,
      tags: ['push', 'wipe'],
    },
    {
      id: 'factory-slide',
      pack: 'factory-alpha',
      file: 'factory/join-slide.webm',
      role: 'join',
      blend: 'alpha',
      durationMs: 600,
      tags: ['slide', 'wipe'],
    },
    {
      id: 'factory-whip',
      pack: 'factory-alpha',
      file: 'factory/join-whip.webm',
      role: 'join',
      blend: 'alpha',
      durationMs: 400,
      tags: ['whip', 'smear', 'fast'],
    },
    {
      id: 'factory-spin',
      pack: 'factory-alpha',
      file: 'factory/join-spin.webm',
      role: 'join',
      blend: 'alpha',
      durationMs: 550,
      tags: ['spin', 'rotate'],
    },
    {
      id: 'factory-shake',
      pack: 'factory-alpha',
      file: 'factory/join-shake.webm',
      role: 'join',
      blend: 'alpha',
      durationMs: 350,
      tags: ['shake', 'impact'],
    },
  ],
};

let failed = 0;
for (const job of jobs) {
  const dest = path.join(outDir, job.file);
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...job.args, dest], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    failed += 1;
    console.error(`failed ${job.file} exit=${result.status}`);
  } else {
    console.log(`ok ${job.file}`);
  }
}

writeFileSync(
  path.join(root, 'assets', 'fx', 'catalog.json'),
  `${JSON.stringify(catalog, null, 2)}\n`,
);
if (failed) process.exit(1);
console.log(`catalog ${catalog.assets.length} assets`);
