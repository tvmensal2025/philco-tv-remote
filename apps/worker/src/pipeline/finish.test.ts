import { describe, expect, it } from 'vitest';
import {
  JOIN,
  joinedDuration,
  joinOverlayFilter,
  joinSpec,
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
});
