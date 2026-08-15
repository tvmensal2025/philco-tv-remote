import { describe, expect, it } from 'vitest';
import { StaleExecutionError } from './status.js';
import { canCommitExecution, canOverwriteTerminalStatus } from '../engine/execution-token.js';

describe('reel execution token', () => {
  it('lets the current execution commit and blocks a late predecessor', () => {
    expect(canCommitExecution('exec-b', 'exec-b')).toBe(true);
    expect(canCommitExecution(null, 'exec-a')).toBe(true);
    expect(canCommitExecution('exec-b', 'exec-a')).toBe(false);
  });

  it('does not let a late attempt move a ready reel', () => {
    expect(canOverwriteTerminalStatus('ready')).toBe(false);
    expect(canOverwriteTerminalStatus('analyzing')).toBe(true);
    expect(() => {
      if (!canCommitExecution('exec-b', 'exec-a')) throw new StaleExecutionError();
    }).toThrow(/STALE_EXECUTION/);
  });
});
