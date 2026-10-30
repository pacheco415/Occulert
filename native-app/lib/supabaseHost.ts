// The only Supabase project this app may send sign-in credentials to. The
// website pins the same host in its Content Security Policy
// (scripts/lib/csp-policy.mjs); the root native cloud test fails if they differ.
export const SUPABASE_HOST = 'wbsynfcjpwlgdzioqpoa.supabase.co';
export const SUPABASE_ORIGIN = `https://${SUPABASE_HOST}`;

// Legacy anon keys are JWTs of a few hundred characters; publishable keys are
// shorter. Both use only URL-safe characters.
const MAX_ANON_KEY_LENGTH = 2048;
const ANON_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface PinnedSupabaseConfig {
  configured: true;
  url: string;
  anonKey: string;
}

/**
 * Accept /api/public-config's Supabase block only when it names the pinned
 * project exactly. Anything else leaves cloud sync unavailable; there is no
 * fallback host.
 */
export function pinnedSupabaseConfig(value: unknown): PinnedSupabaseConfig | null {
  if (!value || typeof value !== 'object') return null;
  const config = value as { configured?: unknown; url?: unknown; anonKey?: unknown };
  if (config.configured !== true || config.url !== SUPABASE_ORIGIN) return null;
  const anonKey = config.anonKey;
  if (typeof anonKey !== 'string' || anonKey.length > MAX_ANON_KEY_LENGTH || !ANON_KEY_PATTERN.test(anonKey)) {
    return null;
  }
  return { configured: true, url: SUPABASE_ORIGIN, anonKey };
}
