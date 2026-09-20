/** The message of anything that was thrown, including values that are not `Error` instances. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
