export const SUPABASE_HOST = 'wbsynfcjpwlgdzioqpoa.supabase.co';

export function auditCspPolicy(value) {
  const entries = String(value).split(';').map(part => part.trim().split(/\s+/)).filter(part => part[0])
    .map(([name, ...sources]) => [name.replace(/[A-Z]/g, letter => letter.toLowerCase()), ...sources]);
  const directives = new Map(entries.map(([name, ...sources]) => [name, sources]));
  const errors = [];
  if (directives.size !== entries.length) errors.push('CSP directives must not be duplicated');
  if (['script-src-elem', 'script-src-attr'].some(name => directives.has(name))) errors.push('Script element and attribute overrides must not bypass the shared script policy');
  const scripts = directives.get('script-src'), connections = directives.get('connect-src');
  if (!scripts) errors.push('CSP must specify script-src');
  else {
    if (scripts.some(source => source === "'unsafe-inline'" || source === "'unsafe-eval'" || /^'(?:sha\d+-|nonce-)/.test(source))) errors.push('Script CSP must allow external owned code without inline or eval grants');
    // Owned files only. A public CDN that serves anyone's uploads would let
    // injected markup load arbitrary script despite this policy.
    const allowedScripts = new Set(["'self'", "'wasm-unsafe-eval'"]);
    if (scripts.some(source => !allowedScripts.has(source))) errors.push('Script CSP contains an unapproved source');
    if (!scripts.includes("'self'") || !scripts.includes("'wasm-unsafe-eval'")) errors.push('Script CSP must retain owned scripts and the pinned WASM runtime');
  }
  if (!connections) errors.push('CSP must specify connect-src');
  else {
    const allowed = new Set([`https://${SUPABASE_HOST}`, `wss://${SUPABASE_HOST}`]);
    if (connections.some(source => source === '*' || /^(?:https?|wss?):$/.test(source))) errors.push('Connection policy must not grant every project host');
    for (const source of connections) if (/supabase\.co/i.test(source) && !allowed.has(source)) errors.push('Supabase connections must use the exact configured project host');
    if (!connections.includes(`https://${SUPABASE_HOST}`)) errors.push('CSP must permit the configured Supabase HTTPS host');
    // Page data may leave only for this site and the configured project. Any
    // other host, including a wildcard cloud domain, is an exfiltration path.
    if (connections.some(source => source !== "'self'" && !allowed.has(source))) errors.push('Connection policy contains an unapproved host');
  }
  return errors;
}
