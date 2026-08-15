import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeCaptionAss, writeProgramAss } from './captions.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('program ASS', () => {
  it('keeps the caption burn for the first 8s', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ass-'));
    dirs.push(dir);
    const file = await writeCaptionAss(dir, 'Prato do dia', 15);
    const body = await readFile(file!, 'utf8');
    expect(body).toContain('PlayResX: 1080');
    expect(body).toContain('PlayResY: 1920');
    expect(body).toContain('Style: Caption,Arial,64');
    expect(body).toContain('Prato do dia');
  });

  it('writes title, wordmark, CTA and end card on the 1080×1920 grid', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ass-'));
    dirs.push(dir);
    const file = await writeProgramAss(dir, 16, {
      title: 'Trattoria Luna',
      wordmark: 'TL',
      cta: 'Peça no salão',
      endCard: 'Trattoria Luna',
    });
    const body = await readFile(file!, 'utf8');
    expect(body).toContain('Style: Title,Arial,72');
    expect(body).toContain('Trattoria Luna');
    expect(body).toContain('Peça no salão');
    expect(body).toContain('Style: EndCard,Arial,70');
    expect(body).toContain('Alignment, MarginL');
  });

  it('returns null when there is nothing to burn', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ass-'));
    dirs.push(dir);
    expect(await writeProgramAss(dir, 12, {})).toBeNull();
  });
});
