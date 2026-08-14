export function isDuplicateJobError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|Job.*exists/i.test(message);
}
