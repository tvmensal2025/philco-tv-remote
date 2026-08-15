import { describe, expect, it } from 'vitest';
import {
  JOIN,
  joinedDuration,
  joinOverlayFilter,
  joinSpec,
  logoOverlayFilter,
  endCardPlateFilter,
  takeFilter,
  takeFilterStatic,
  xfadeChain,
} from '../pipeline/finish.js';

describe('finish graph', () => {
  it('makes dissolves long enough to read on a phone', () => {
    expect(JOIN.dissolve.duration).toBeGreaterThanOrEqual(0.5);
    expect(JOIN.fadeblack.duration).toBeGreaterThanOrEqual(0.4);
    expect(JOIN.cut.duration).toBeLessThan(0.08);
  });

  it('shortens the timeline by the overlap of each join', () => {
    const duration = joinedDuration([
      { duration: 4, transition: 'fadein' },
      { duration: 4, transition: 'dissolve' },
      { duration: 3, transition: 'fadeblack' },
    ]);
    expect(duration).toBeCloseTo(4 + 4 - 0.58 + 3 - 0.5, 2);
  });

  it('builds an xfade chain with fadeblack on the food insert', () => {
    const chain = xfadeChain([
      { duration: 4, transition: 'fadein' },
      { duration: 4, transition: 'dissolve' },
      { duration: 3, transition: 'fadeblack' },
    ]);
    expect(chain.filter).toContain('transition=fade:duration=0.58');
    expect(chain.filter).toContain('transition=fadeblack');
    expect(chain.output).toBe('xf');
  });

  it('treats unknown joins as almost-hard cuts, not concat', () => {
    expect(joinSpec('none').duration).toBe(0.04);
  });

  it('lets the studio override pulse join time without inventing a new xfade', () => {
    expect(joinSpec('cut', 0.12).duration).toBeCloseTo(0.12);
    expect(joinSpec('cut', 0.12).name).toBe('fade');
    const duration = joinedDuration([
      { duration: 1.9, transition: 'cut' },
      { duration: 1.9, transition: 'cut', joinDuration: 0.12 },
    ]);
    expect(duration).toBeCloseTo(1.9 + 1.9 - 0.12, 2);
  });

  it('refuses a dissolve that is actually a cut', () => {
    expect(joinSpec('dissolve', 0.04).duration).toBeGreaterThanOrEqual(0.4);
    expect(joinSpec('fadeblack', 0.04).duration).toBeGreaterThanOrEqual(0.35);
  });

  it('keeps eval=frame only on HIGH motion; STANDARD is a static crop', () => {
    const high = takeFilter({ source_start_offset: 1, duration: 3, motion: 'punch' }, 0);
    const standard = takeFilterStatic({ source_start_offset: 1, duration: 3, punchIn: true }, 0);
    expect(high).toContain('eval=frame');
    expect(standard).not.toContain('eval=frame');
    expect(standard).toContain('crop=1080:1920');
  });

  it('puts the YOLO window before the 9:16 scale', () => {
    const filter = takeFilterStatic(
      { source_start_offset: 1, duration: 3, crop: [690, 0, 608, 1080] },
      0,
    );
    expect(filter).toContain('crop=608:1080:690:0,scale=1080:1920');
  });

  it('ignores a 480px vision crop instead of slicing a postage stamp out of HD', () => {
    const filter = takeFilterStatic(
      { source_start_offset: 1, duration: 3, crop: [60, 0, 151, 270] },
      0,
    );
    expect(filter).not.toContain('crop=151:270');
    expect(filter).toContain('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920');
  });

  it('locks the 9:16 window when the subject is already tight', () => {
    const filter = takeFilter(
      {
        source_start_offset: 1,
        duration: 3,
        motion: 'drift',
        cropTight: true,
        crop: [300, 0, 405, 720],
      },
      0,
    );
    expect(filter).not.toContain('eval=frame');
    expect(filter).toContain('crop=404:720:300:0');
  });

  it('letterboxes a wide bbox even when cropMode was dropped', () => {
    const filter = takeFilter({ source_start_offset: 1, duration: 3, crop: [77, 0, 446, 720] }, 0);
    expect(filter).toContain('gblur=sigma=16');
    expect(filter).toContain('force_original_aspect_ratio=decrease');
  });

  it('letterboxes with blur when the body does not fit 9:16', () => {
    const filter = takeFilter(
      {
        source_start_offset: 1,
        duration: 3,
        cropMode: 'pad_blur',
        crop: [80, 40, 720, 640],
      },
      0,
    );
    expect(filter).toContain('gblur=sigma=16');
    expect(filter).toContain('scale=270:480');
    expect(filter).toContain('force_original_aspect_ratio=decrease');
    expect(filter).not.toContain('eval=frame');
  });

  it('keeps pad_blur in the static/safe graph so a fallback render does not clip the body', () => {
    const filter = takeFilterStatic(
      {
        source_start_offset: 1,
        duration: 3,
        cropMode: 'pad_blur',
        crop: [80, 40, 720, 640],
      },
      0,
    );
    expect(filter).toContain('gblur=sigma=16');
    expect(filter).not.toContain('force_original_aspect_ratio=increase,crop=1080:1920,fps=30');
  });

  it('puts a transparent flash on top of the xfade, centered on the join', () => {
    const overlay = joinOverlayFilter([
      { duration: 4, transition: 'cut' },
      { duration: 4, transition: 'dissolve', joinOverlay: 'flash' },
    ]);
    expect(overlay.output).toBe('ov');
    expect(overlay.filter).toContain('format=yuva420p');
    expect(overlay.filter).toContain('overlay=0:0:eof_action=pass');
    expect(overlay.filter).toContain('color=c=0xFFFFFF@0.82');
    expect(overlay.filter).not.toContain('eval=frame');
    expect(joinOverlayFilter([{ duration: 2, transition: 'cut' }]).filter).toBe('');
  });

  it('places the partner logo at the Casa safe-area box', () => {
    const filter = logoOverlayFilter('[basev]', 3);
    expect(filter).toContain('[3:v]format=rgba');
    expect(filter).toContain('overlay=90:250');
    expect(filter).toContain('[logov]');
  });

  it('fades a dark plate over the last 1.55s for the end card', () => {
    const filter = endCardPlateFilter('[logov]', 16);
    expect(filter).toContain('color=c=0x0a0a0a@0.72:s=1080x1920');
    expect(filter).toContain("enable='gte(t,14.450)'");
  });
});
