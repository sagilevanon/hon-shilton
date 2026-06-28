// The one vocabulary of truthy strings the backend accepts for boolean flags,
// shared by the REVIEW_GATE env flag (index.ts) and query-string flags like
// includeHubs (endpoints.ts) so the two can never drift apart.
export function isFlagOn(value: unknown): boolean {
  return value != null && ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase());
}
