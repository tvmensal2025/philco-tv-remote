import { describe, expect, it } from 'vitest';
import {
  greetingForHour,
  hourBars,
  humanReelFailure,
  readyByDay,
  todayCounts,
  zonedDayKey,
} from './house-today';

const zone = 'America/Sao_Paulo';
const now = new Date('2026-08-15T18:00:00.000Z');

describe('house today', () => {
  it('splits today into ready, queue, approve and failed', () => {
    const counts = todayCounts(
      [
        { id: '1', status: 'ready', created_at: '2026-08-15T16:00:00.000Z' },
        { id: '2', status: 'queued', created_at: '2026-08-15T16:10:00.000Z' },
        { id: '3', status: 'failed', created_at: '2026-08-15T16:20:00.000Z' },
        { id: '4', status: 'approved', created_at: '2026-08-14T16:00:00.000Z' },
      ],
      zone,
      now,
    );
    expect(zonedDayKey(now, zone)).toBe('2026-08-15');
    expect(counts).toEqual({ ready: 1, queued: 1, toApprove: 1, failed: 1 });
  });

  it('counts ready films across the last seven days', () => {
    const series = readyByDay(
      [
        { id: '1', status: 'ready', created_at: '2026-08-15T12:00:00.000Z' },
        { id: '2', status: 'published', created_at: '2026-08-15T13:00:00.000Z' },
        { id: '3', status: 'queued', created_at: '2026-08-15T14:00:00.000Z' },
      ],
      zone,
      now,
    );
    expect(series).toHaveLength(7);
    expect(series.at(-1)?.prontos).toBe(2);
  });

  it('groups moment cuts by house hour', () => {
    const bars = hourBars(
      [{ occurred_at: '2026-08-15T16:42:00.000Z' }, { occurred_at: '2026-08-15T16:50:00.000Z' }],
      zone,
    );
    const lunch = bars.find((row) => row.hour === 13);
    expect(lunch?.cortes).toBe(2);
  });

  it('greets in Portuguese and hides SKIP_PROGRAM jargon', () => {
    expect(greetingForHour(9)).toBe('Bom dia');
    expect(greetingForHour(15)).toBe('Boa tarde');
    expect(humanReelFailure('SKIP_PROGRAM', 'MISSING_ROLE')).toBe(
      'Este corte não tinha ângulo suficiente.',
    );
  });
});
