import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const failures = [];
const htmlFiles = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if ([".git", "node_modules", "native-app"].includes(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else if (extname(path) === ".html") htmlFiles.push(path);
  }
}

function fail(message) {
  failures.push(message);
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assertIncludes(path, needle, message) {
  if (!read(path).includes(needle)) fail(message);
}

function assertNotIncludes(path, needle, message) {
  if (read(path).includes(needle)) fail(message);
}

function assertSingleH1(path) {
  const count = (read(path).match(/<h1\b/gi) || []).length;
  if (count !== 1) fail(`${path} must contain exactly one h1 (found ${count})`);
}

walk(root);

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [index, match] of inlineScripts.entries()) {
    try { new Function(match[1]); }
    catch (error) { fail(`${file}: inline script ${index + 1} does not parse (${error.message})`); }
  }
  const refs = [...html.matchAll(/\b(?:href|src)=["']([^"'#?]+)[^"']*["']/g)].map((match) => match[1]);
  for (const ref of refs) {
    if (!ref.startsWith("/") || ref.startsWith("//")) continue;
    const target = normalize(join(root, ref.slice(1)));
    if (!target.startsWith(root)) fail(`${file}: invalid local reference ${ref}`);
    try {
      statSync(target);
    } catch {
      fail(`${file}: missing local reference ${ref}`);
    }
  }
}

assertIncludes("firebase-config.js", "OCCULERT_FIREBASE_ENABLED = false", "firebase-config.js must keep cloud sync disabled by default");
assertIncludes("firebase-config.js", "OCCULERT_FIREBASE_CONFIG = null", "firebase-config.js must not ship a live public config by default");
assertIncludes("vercel.json", "\"source\": \"/firebase-config.js\"", "vercel.json must include a firebase-config.js cache rule");
assertIncludes("vercel.json", "\"value\": \"no-store\"", "vercel.json must include no-store for sensitive helper files");
assertIncludes("vercel.json", "\"key\": \"Content-Security-Policy\"", "vercel.json must enforce its tested CSP");
assertIncludes("vercel.json", "https://unpkg.com", "vercel.json CSP must allow Leaflet assets used by the fleet map");
assertIncludes("vercel.json", "https://fonts.googleapis.com", "vercel.json CSP must allow Google Fonts stylesheets used by marketing pages");
assertIncludes("vercel.json", "font-src 'self' https://fonts.gstatic.com", "vercel.json CSP must allow Google Fonts font files");
assertIncludes("vercel.json", "https://*.supabase.co", "vercel.json CSP must allow configured Supabase Auth requests");
assertIncludes("vercel.json", "\"source\": \"/occulert-backend.js\"", "browser auth helper must not be cached across configuration changes");
assertNotIncludes("occulert-backend.js", "PASTE_ANON_KEY_HERE", "browser backend client must not ship placeholder credentials");
assertIncludes("occulert-backend.js", "/api/public-config", "browser backend client must load public runtime configuration");
assertIncludes("occulert-backend.js", "redirect_to=", "signup confirmation emails must return users to the active Occulert site");
assertIncludes("api/public-config.js", "SUPABASE_ANON_KEY", "public config endpoint must read the browser-safe anon key from the environment");
assertNotIncludes("api/public-config.js", "SUPABASE_SERVICE_ROLE_KEY", "public config endpoint must never expose the service-role key");
assertIncludes("api/profile.js", "fleet_id: null", "driver profile creation must not trust caller-provided fleet membership");
assertIncludes("db/schema.sql", "drivers_user_id_unique", "driver profiles must be unique per authenticated user");
assertIncludes("db/schema.sql", "fleets_owner_user_id_unique", "fleet managers must own at most one fleet");
assertIncludes("db/schema.sql", "create table if not exists fleet_invitations", "database schema must include protected fleet invitations");
assertIncludes("db/schema.sql", "security definer", "invitation acceptance must use an atomic database function");
assertIncludes("db/schema.sql", "grant execute on function public.accept_fleet_invitation(text, uuid, text) to service_role", "invitation acceptance must be service-role-only");
assertIncludes("api/fleet-invitations.js", "crypto.randomBytes(32)", "fleet invitations must use cryptographically random tokens");
assertIncludes("api/fleet-invitations.js", "token_hash: tokenHash", "fleet invitations must store only token hashes");
assertNotIncludes("api/fleet-invitations.js", "token: token", "fleet invitations must not store raw tokens");
assertIncludes("api/fleet-invitations.js", "MAX_INVITATIONS_PER_HOUR", "fleet invitation creation must have a server-side abuse limit");
assertIncludes("api/fleet-invitations.js", "replace_invitation_id", "resending must replace the old one-time invitation");
assertIncludes("api/accept-invitation.js", "email_confirmed_at", "invitation acceptance must require a verified email");
assertIncludes("api/accept-invitation.js", "rpc/accept_fleet_invitation", "invitation acceptance must use the atomic database function");
assertIncludes("sw.js", "url.pathname.startsWith('/api/')", "service worker must never intercept or cache API responses");
assertIncludes("api/sessions.js", "driver_id: \"eq.\" + driver.id", "session updates must be scoped to the authenticated driver's own sessions");
assertIncludes("api/events.js", "driver_id: \"eq.\" + driver.id", "event writes must verify the session belongs to the authenticated driver");
assertIncludes("api/events.js", "numberOrNull(body.latitude, -90, 90)", "event GPS latitude must be range validated");
assertIncludes("api/sessions.js", "MAX_BODY_LENGTH", "session API must reject oversized JSON bodies");
assertIncludes("api/pilot-leads.js", "body.website", "pilot lead API must include honeypot spam filtering");
assertIncludes("pilot-signup.html", "startedAt:formStartedAt", "pilot signup must send form timing metadata for basic spam filtering");
assertIncludes("api/pilot-leads.js", "rateLimited(request)", "pilot lead API must rate limit submission bursts");
assertIncludes("api/pilot-leads.js", "pgFetch(\"pilot_leads\"", "pilot lead API must support durable Supabase storage");
assertIncludes("db/schema.sql", "create table if not exists pilot_leads", "database schema must include pilot lead storage");
assertIncludes("pilot-signup.html", "<form class=\"card\"", "pilot signup controls must use a semantic form");
assertIncludes("app.html", "trigger=_patched", "enhanced alert behavior must replace the active trigger function");
assertIncludes("app.html", "if(alerts===previousAlerts)return", "enhanced alert behavior must respect alert cooldowns");
assertIncludes("app.html", "window.OcculertBackend.startSession()", "driver app must start protected cloud sessions when opted in");
assertIncludes("app.html", "window.OcculertBackend.endSession", "driver app must finish protected cloud sessions when opted in");
assertIncludes("app.html", "queueBackendEvent", "driver app must queue protected alert events when opted in");
assertIncludes("login.html", "src=\"/occulert-backend.js\"", "login must load the Supabase backend client");
assertNotIncludes("login.html", "id=\"fleetId\"", "login must not offer caller-controlled fleet membership");
assertIncludes("login.html", "Google and passkey sign-in are coming soon", "login must not present disabled authentication methods as active");
assertNotIncludes("login.html", "onclick=\"passkeyAuth()\"", "login must not offer a nonfunctional passkey action");
assertNotIncludes("login.html", "onclick=\"googleAuth()\"", "login must not offer a nonfunctional Google action");
assertIncludes("fleet-onboarding.html", "createFleetInvitation", "fleet onboarding must create protected invitations through the API");
assertIncludes("fleet-onboarding.html", "resendFleetInvitation", "fleet onboarding must support replacing pending invitation links");
assertIncludes("fleet-onboarding.html", "mailto:", "fleet onboarding must support no-cost sharing through the manager's mail app");
assertIncludes("fleet-onboarding.html", "Copy Link", "fleet onboarding must preserve a copy-link fallback");
assertIncludes("accept-invite.html", "history.replaceState", "invite pages must immediately remove tokens from the visible URL");
assertIncludes("accept-invite.html", "sessionStorage", "invite tokens must stay out of persistent local storage");
assertIncludes("accept-invite.html", ".hidden{display:none!important}", "invite success actions must remain hidden until acceptance succeeds");
assertIncludes("accept-invite.html", "OcculertBackend.authMessage", "invite auth failures must show actionable messages");
assertIncludes("accept-invite.html", "setAuthBusy(true)", "invite auth actions must prevent duplicate in-flight requests");
assertNotIncludes("app.html", "oninput=\"typeof setSensitivity", "driver app must not keep the conflicting numeric sensitivity slider");
for (const path of ["features.html", "how-it-works.html", "install.html"]) assertSingleH1(path);
assertIncludes("account.html", "function esc(v)", "account.html must escape rendered profile fields");
assertIncludes("native-app/components/AlertSystem.tsx", "../assets/alert.wav", "native alert sound must be bundled locally");
assertIncludes("native-app/app/monitor.tsx", "AsyncStorage.setItem(HISTORY_KEY", "native monitor must save completed sessions for the history screen");
assertIncludes("native-app/app/history.tsx", "openFeedback(item)", "native session history must offer pilot feedback tied to a completed session");
assertIncludes("native-app/lib/feedback.ts", "No camera images, video, audio, or location are attached.", "native pilot feedback must state that sensitive media and location are not attached");
assertIncludes("native-app/app.json", "NSLocationWhenInUseUsageDescription", "native iOS builds must explain optional location access to satisfy App Store validation");
assertIncludes("fleet-dashboard.html", "id=\"driverSearch\"", "fleet dashboard must keep driver search controls");
assertIncludes("fleet-dashboard.html", "function exportFleetCSV()", "fleet dashboard must keep CSV export");
assertIncludes("fleet-dashboard.html", "function seedDemoData()", "fleet dashboard must keep demo data loading");
assertIncludes("fleet-dashboard.html", "function copyDriver(id)", "fleet dashboard must keep per-driver copy summaries");
assertIncludes("fleet-dashboard.html", "getFleetSummary()", "signed-in fleet dashboards must use the owner-scoped backend summary");
assertIncludes("fleet-dashboard.html", "!fleetMode&&local", "protected fleet dashboards must not fall back to unrelated local driver data");
for (const path of ["fleet-onboarding.html", "accept-invite.html"]) assertSingleH1(path);
assertIncludes("api/pilot-leads.js", "origin_not_allowed", "pilot lead API must reject cross-origin submissions");
assertIncludes("api/pilot-leads.js", "unsupported_media_type", "pilot lead API must require JSON submissions");
assertIncludes("api/pilot-leads.js", "url.protocol === \"https:\"", "pilot lead API must only forward to HTTPS webhooks");
for (const workflow of [".github/workflows/browser-smoke.yml", ".github/workflows/native-app-typecheck.yml", ".github/workflows/site-audit.yml"]) {
  assertIncludes(workflow, "actions/checkout@v6", `${workflow} must use the Node 24 checkout action`);
  assertIncludes(workflow, "actions/setup-node@v6", `${workflow} must use the Node 24 setup action`);
  assertIncludes(workflow, "node-version: 24", `${workflow} must test on Node 24`);
}
assertIncludes("package.json", "\"node\": \"24.x\"", "Vercel functions and local checks must use the verified Node 24 runtime");

if (failures.length) {
  console.error("Occulert site audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Occulert site audit passed (${htmlFiles.length} HTML files checked).`);
