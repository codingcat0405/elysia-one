// Single source of truth for CLIENT_URL parsing. Used by both Elysia's CORS
// (index.ts) and Better Auth's trustedOrigins (auth.ts) — they must always
// agree, since trustedOrigins is half of the CSRF defense that replaced
// SameSite=Strict. A future edit to origin-parsing (scheme normalization,
// trailing slashes, etc.) only needs to happen here, not in two files that
// could silently drift apart.
export function getClientOrigins(): string[] {
  return (process.env.CLIENT_URL ?? 'http://localhost:3001')
    .split(',')
    .map((s) => s.trim())
}
