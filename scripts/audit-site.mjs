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

for (const scriptPath of ["homepage.js", "lang.js"]) {
  try { new Function(read(scriptPath)); }
  catch (error) { fail(`${scriptPath} does not parse (${error.message})`); }
}

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

assertIncludes("index.html", "<link rel=\"stylesheet\" href=\"/homepage.css\" />", "homepage must load its external stylesheet");
assertIncludes("index.html", "<script src=\"/homepage.js\" defer></script>", "homepage must load its external behavior script");
assertNotIncludes("index.html", "<style>", "homepage must keep its styles out of the HTML document");
assertNotIncludes("index.html", "<script>", "homepage must keep its behavior script out of the HTML document");
for (const unsupportedStat of ["1 in 6", "100,000+", "91%", "Crashes involve driver fatigue"]) {
  assertNotIncludes("index.html", unsupportedStat, `homepage must not present the unsupported statistic: ${unsupportedStat}`);
}
for (const productBoundary of [
  "Camera frames are processed locally",
  "Monitoring stops when Occulert leaves the screen",
  "Local monitoring works without fleet sync",
  "May miss events or trigger false alerts",
]) {
  assertIncludes("index.html", productBoundary, `homepage must disclose the product boundary: ${productBoundary}`);
}
for (let index = 1; index <= 4; index += 1) {
  for (const prefix of ["stats_value", "stats_label"]) {
    const key = `${prefix}${index}:`;
    const count = read("lang.js").split(key).length - 1;
    if (count !== 8) fail(`translations must include ${key.slice(0, -1)} for all 8 languages (found ${count})`);
  }
}
assertIncludes("sw.js", "'/homepage.css'", "service worker must cache the external homepage stylesheet");
assertIncludes("sw.js", "'/homepage.js'", "service worker must cache the external homepage behavior script");
assertIncludes("app.html", "<link rel=\"stylesheet\" href=\"/driver-app.css\" />", "driver app must load its external stylesheet");
assertNotIncludes("app.html", "<style>", "driver app must keep its styles out of the HTML document");
assertIncludes("driver-app.css", "--overlay-dim", "driver app stylesheet must preserve display-intensity controls");
assertIncludes("sw.js", "'/driver-app.css'", "service worker must cache the external driver app stylesheet");
assertIncludes("vercel.json", "\"value\": \"no-store\"", "vercel.json must include no-store for sensitive helper files");
assertIncludes("vercel.json", "\"key\": \"Content-Security-Policy\"", "vercel.json must enforce its tested CSP");
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
assertIncludes("api/pilot-leads.js", "rateLimitState(request)", "pilot lead API must use durable distributed rate limiting");
assertIncludes("api/pilot-leads.js", "pgFetch(\"pilot_leads\"", "pilot lead API must support durable Supabase storage");
assertIncludes("db/schema.sql", "create table if not exists pilot_leads", "database schema must include pilot lead storage");
assertIncludes("pilot-signup.html", "<form class=\"card\"", "pilot signup controls must use a semantic form");
assertIncludes("app.html", "trigger=_patched", "enhanced alert behavior must replace the active trigger function");
assertIncludes("app.html", "if(alerts===previousAlerts)return", "enhanced alert behavior must respect alert cooldowns");
assertIncludes("app.html", "window.OcculertBackend.startSession()", "driver app must start protected cloud sessions when opted in");
assertIncludes("app.html", "window.OcculertBackend.endSession", "driver app must finish protected cloud sessions when opted in");
assertIncludes("app.html", "queueBackendEvent", "driver app must queue protected alert events when opted in");
assertIncludes("app.html", "function cameraRecoveryGuidance", "driver app must keep camera failure recovery guidance available");
assertIncludes("app.html", "const recovery=cameraRecoveryGuidance(e)", "driver app must show recovery guidance after camera startup failures");
assertIncludes("app.html", "Website Settings → Camera → Allow", "driver app must explain iPhone and iPad camera recovery");
assertIncludes("app.html", "Permissions → Camera → Allow", "driver app must explain Android camera recovery");
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
assertIncludes("account.html", "OcculertBackend.updateEmail", "account email changes must go through Supabase Auth");
assertIncludes("account.html", "OcculertBackend.updatePassword", "account password changes must go through Supabase Auth");
assertNotIncludes("account.html", "window.firebase", "account.html must not call the retired Firebase SDK");
assertIncludes("account.html", "Your sign-in email changes once you open the link", "email changes must disclose that confirmation is required");
assertIncludes("account.html", "your current address may receive one too", "email changes must account for secure-email-change double confirmation");
assertIncludes("account.html", "setBusy('emailBtn',true", "account credential actions must prevent duplicate in-flight requests");
assertIncludes("occulert-backend.js", "/auth/v1/user", "backend client must expose authenticated account updates");
assertIncludes("occulert-backend.js", "Authorization: \"Bearer \" + auth.access_token", "account updates must be authorized with the live session token");
assertIncludes("native-app/components/AlertSystem.tsx", "../assets/alert.wav", "native alert sound must be bundled locally");
assertIncludes("native-app/app/monitor.tsx", "updateSessionHistory", "native monitor must serialize completed-session history writes");
assertIncludes("native-app/app/history.tsx", "openFeedback(item)", "native session history must offer pilot feedback tied to a completed session");
assertIncludes("native-app/lib/feedback.ts", "No camera images, video, audio, raw motion readings, or location are attached.", "native pilot feedback must state that sensitive media, raw motion, and location are not attached");
assertIncludes("native-app/app/history.tsx", "false_alert", "native session history must capture structured false-alert feedback");
assertIncludes("native-app/app/history.tsx", "missed_alert", "native session history must capture structured missed-alert feedback");
assertIncludes("native-app/app/history.tsx", "Saved only on this iPhone", "native alert assessments must disclose their local-only storage");
assertIncludes("native-app/app/monitor.tsx", "sensitivity: sessionSensitivityRef.current", "native session history must preserve the sensitivity used for each session");
assertIncludes("native-app/app/history.tsx", "CHECKPOINT_TARGET = 10", "native history must track progress toward the first 10-session accuracy checkpoint");
assertIncludes("native-app/app/history.tsx", "item.sensitivity === 'medium'", "native accuracy checkpoint must count only reviewed Medium-sensitivity sessions");
assertIncludes("native-app/app/history.tsx", "Ratings stay on this iPhone", "native accuracy checkpoint must disclose local-only rating storage");
assertIncludes("native-app/lib/feedback.ts", "Alert assessment:", "native session feedback must include the tester's alert assessment");
assertIncludes("native-app/lib/feedback.ts", "Sensitivity:", "native session feedback must include the recorded sensitivity");
assertIncludes("native-app/app/history.tsx", "Record only after you are safely parked.", "native test-condition review must prohibit in-drive interaction");
assertIncludes("native-app/app/history.tsx", "Conditions stay on this iPhone", "native test conditions must disclose local-only storage");
assertIncludes("native-app/app/history.tsx", "TEST CONDITION COVERAGE", "native pilot checkpoint must summarize test-condition coverage");
assertIncludes("native-app/lib/feedback.ts", "Phone position:", "native session feedback must include structured test conditions");
assertIncludes("native-app/app/history.tsx", "tester observations, not device measurements", "native device-impact review must not misrepresent subjective observations as measurements");
assertIncludes("native-app/app/history.tsx", "let the phone cool before another session", "native device-impact review must give safe temperature-warning guidance");
assertIncludes("native-app/lib/feedback.ts", "Battery impact (tester-reported):", "native session feedback must label subjective battery observations");
assertIncludes("native-app/lib/feedback.ts", "Phone heat (tester-reported):", "native session feedback must label subjective phone-heat observations");
assertIncludes("native-app/app/history.tsx", "Review complete", "native history must identify fully reviewed sessions");
assertIncludes("native-app/app/history.tsx", "Needs review", "native history must identify incomplete session reviews");
assertIncludes("native-app/app/history.tsx", "expanded: isExpanded", "native session review details must expose their expanded state for accessibility");
assertIncludes("native-app/app/monitor.tsx", "...currentAppBuildInfo()", "native sessions must preserve their exact app version and native build");
assertIncludes("native-app/lib/appBuildInfo.ts", "Constants.platform?.ios?.buildNumber", "native pilot metadata must use the embedded immutable iOS build number");
assertIncludes("native-app/lib/feedback.ts", "Build number:", "native session feedback must include the recorded native build number");
assertNotIncludes("native-app/lib/feedback.ts", "App version: 1.0.0", "native feedback must not hardcode an app version");
assertIncludes("native-app/app/history.tsx", "router.push('/pre-drive')", "native history must route monitoring through the pre-drive safety gate");
assertIncludes("native-app/app.json", "NSLocationWhenInUseUsageDescription", "native iOS builds must explain optional location access to satisfy App Store validation");
assertIncludes("native-app/app/monitor.tsx", "CLOSED_CONFIRM_MS = 1_200", "native monitoring must confirm sustained eye closure before a full alert");
assertIncludes("native-app/app/monitor.tsx", "headNodObservationsRef.current += 1", "native monitoring must store candidate head-nod observations locally");
assertIncludes("native-app/app/history.tsx", "Does not trigger alerts", "experimental head-nod observations must not be presented as an alert signal");
assertNotIncludes("native-app/components/AlertSystem.tsx", "headNod", "unvalidated head-nod observations must not affect alert delivery");
assertNotIncludes("native-app/lib/cloudSync.ts", "headNodObservations", "unvalidated head-nod observations must remain out of cloud sync");
assertIncludes("native-app/app.json", "NSMotionUsageDescription", "native iOS builds must explain compatible-headphone motion access");
assertIncludes("native-app/app/monitor.tsx", "headphoneHeadNodObservationsRef.current += 1", "native monitoring must keep headphone candidate observations separate");
assertIncludes("native-app/app/history.tsx", "Saved locally as aggregate observations only", "native history must disclose aggregate-only head-motion storage");
assertNotIncludes("native-app/lib/cloudSync.ts", "headphoneMotionSamples", "raw headphone-motion diagnostics must remain out of cloud sync");
assertNotIncludes("native-app/components/AlertSystem.tsx", "headphoneMotion", "unvalidated headphone motion must not affect alert delivery");
assertIncludes("native-app/lib/alertPolicy.ts", "CRITICAL_WARMUP_SECONDS = 10", "native monitoring must not trigger a critical alert immediately after startup");
assertIncludes("native-app/lib/alertPolicy.ts", "metrics.state === 'closed'", "native critical alerts must clear when the driver's eyes reopen");
assertIncludes("native-app/components/AlertSystem.tsx", "deriveAlertLevel", "native alerts must use the tested alert policy");
assertIncludes("native-app/components/AlertSystem.tsx", "shouldDeliverAlert", "native alert escalation must use the tested cooldown policy");
assertIncludes("native-app/components/AlertSystem.tsx", "setTrackingLost(true)", "native monitoring must apply a grace period before warning about tracking loss");
assertIncludes("native-app/components/AlertSystem.tsx", "TRACKING LOST", "native monitoring must warn after sustained tracking loss");
assertIncludes("native-app/components/AlertSystem.tsx", "top:132", "native alert banners must remain below the top navigation");
assertIncludes("native-app/app/monitor.tsx", "sensorFault: { position: 'absolute', top: 132", "native sensor-fault banners must remain below the top navigation");
assertNotIncludes("native-app/app/monitor.tsx", "Alert.alert('Monitoring stopped'", "native sensor faults must not stack a blocking modal over the in-app warning");
assertIncludes("native-app/app/monitor.tsx", "SENSOR_STARTUP_GRACE_MS = 10_000", "native camera startup must have a distinct first-frame grace period");
assertIncludes("native-app/app/monitor.tsx", "hasCameraSampleRef.current ? SENSOR_STALL_MS : SENSOR_STARTUP_GRACE_MS", "native camera watchdog must distinguish startup from an active-pipeline stall");
assertIncludes("native-app/app/monitor.tsx", "<View style={s.ctrl}>\n          {isRunning && (\n            <View style={s.metrics}>", "native metrics must share the control layout flow so alert actions cannot overlap them");
assertNotIncludes("native-app/app/monitor.tsx", "metrics: {\n    position: 'absolute'", "native metrics must not rely on a fixed bottom offset that can overlap added controls");
assertIncludes("native-app/lib/watchBridge.ts", "getIsWatchAppInstalled", "Apple Watch controls must require the companion app, not pairing alone");
assertIncludes("native-app/app/settings.tsx", "AUTOMATIC", "connected audio settings must describe iPhone output routing truthfully");
assertIncludes("native-app/components/AlertSystem.tsx", "getWatchAlertsEnabled(true)", "native alerts must read the latest Watch preference instead of a stale mount-time value");
assertIncludes("native-app/lib/watchBridge.ts", "transferUserInfo", "Watch alerts must have a reliable queued delivery fallback");
assertIncludes("native-app/targets/occulert-watch/AlertReceiver.swift", "didReceiveUserInfo", "the Watch companion must receive queued alert deliveries");
assertIncludes("native-app/app/settings.tsx", "Test Watch alert", "connected-device settings must provide a direct Watch alert test");
assertIncludes("native-app/app.json", "@bacons/apple-targets", "native iOS builds must package the Watch companion target");
assertIncludes("native-app/targets/occulert-watch/expo-target.config.js", "type: 'watch'", "the Watch companion must be configured as a watchOS target");
assertIncludes("native-app/targets/occulert-watch/AlertReceiver.swift", "WKInterfaceDevice.current()", "the Watch companion must play wrist haptics locally");
assertIncludes("native-app/targets/occulert-watch/AlertReceiver.swift", "Tracking lost — check iPhone safely", "the Watch companion must explain tracking-loss alerts");
assertIncludes("fleet-dashboard.html", "id=\"driverSearch\"", "fleet dashboard must keep driver search controls");
assertIncludes("fleet-dashboard.html", "function exportFleetCSV()", "fleet dashboard must keep CSV export");
assertIncludes("fleet-dashboard.html", "function seedDemoData()", "fleet dashboard must keep demo data loading");
assertIncludes("fleet-dashboard.html", "function copyDriver(id)", "fleet dashboard must keep per-driver copy summaries");
assertIncludes("fleet-dashboard.html", "getFleetSummary()", "signed-in fleet dashboards must use the owner-scoped backend summary");
assertIncludes("fleet-dashboard.html", "!fleetMode&&local", "protected fleet dashboards must not fall back to unrelated local driver data");
assertIncludes("fleet-dashboard.html", "id=\"sessionHistory\"", "fleet dashboard must render protected session history");
assertIncludes("fleet-dashboard.html", "function exportSessionHistoryCSV()", "protected session history must keep a privacy-safe export");
assertIncludes("fleet-dashboard.html", "OcculertSecurity.csvCell", "fleet exports must neutralize spreadsheet formulas");
assertIncludes("api/fleet-summary.js", "includes_location: false", "fleet history responses must explicitly exclude location");
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
assertNotIncludes("how-it-works.html", "runs silently in the background", "public copy must not claim unsupported background monitoring");
assertIncludes("how-it-works.html", "open in the foreground", "public copy must disclose that monitoring requires the foreground");
assertIncludes("app.html", "async function handleVisibilityChange", "web monitoring must handle foreground loss explicitly");
assertIncludes("app.html", "Monitoring stopped because Occulert left the foreground", "web monitoring must visibly stop after foreground loss");

if (failures.length) {
  console.error("Occulert site audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Occulert site audit passed (${htmlFiles.length} HTML files checked).`);
