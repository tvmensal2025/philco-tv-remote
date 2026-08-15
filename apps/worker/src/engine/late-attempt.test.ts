import { canCommitExecution, canOverwriteTerminalStatus } from './execution-token.js';
import { canPromoteFinalOutput } from '@reelops/shared';
import { describe, expect, it } from 'vitest';

describe('late attempt REAL gate', () => {
  it('blocks predecessor A after B owns the execution and forbids canonical promote', () => {
    const current = 'exec-b';
    expect(canCommitExecution(current, 'exec-a')).toBe(false);
    expect(canPromoteFinalOutput(current, 'exec-a')).toBe(false);
    expect(canOverwriteTerminalStatus('ready')).toBe(false);
    expect(canCommitExecution(current, 'exec-b')).toBe(true);
    expect(canPromoteFinalOutput(current, 'exec-b')).toBe(true);
  });
});
