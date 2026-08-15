export function canCommitExecution(
  currentExecutionId: string | null | undefined,
  claimExecutionId: string,
) {
  if (!currentExecutionId) return true;
  return currentExecutionId === claimExecutionId;
}

export function canOverwriteTerminalStatus(currentStatus: string) {
  return !['ready', 'approved', 'publishing', 'published', 'discarded'].includes(currentStatus);
}
