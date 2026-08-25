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

for (const scriptPath of ["homepage.js", "lang.js", "passkey-auth.js", "supabase-loader.js"]) {
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

assertIncludes("index.html", "<link rel=\"stylesheet\" href=\"/homepage.css?v=31\" />", "homepage must load its versioned external stylesheet");
assertNotIncludes("index.html", "href=\"/homepage.css\"", "homepage must not reuse the previously immutable stylesheet URL");
assertIncludes("index.html", "href=\"/homepage-journey-cinematic-v1.jpg\"", "homepage must preload its cinematic journey image");
assertIncludes("index.html", "class=\"journey-frame journey-frame-enter\"", "homepage must render the cinematic enter frame");
assertNotIncludes("index.html", "class=\"car-shell\"", "homepage must not render the retired flat CSS car");
assertIncludes("index.html", "<script src=\"/homepage.js\" defer></script>", "homepage must load its external behavior script");
assertNotIncludes("index.html", "<style>", "homepage must keep its styles out of the HTML document");
const homepageInlineScripts = [...read("index.html").matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gi)].length;
if (homepageInlineScripts !== 1) fail(`homepage must contain only the early password-recovery handoff script (found ${homepageInlineScripts})`);
assertIncludes("index.html", "params.get('type')==='recovery'", "homepage must detect recovery links that fall back to the site root");
assertIncludes("index.html", "'/account.html?recovery=1'+hash", "homepage must preserve recovery tokens while handing off to Account Setup");
assertIncludes("index.html", "id=\"safetyJourney\"", "homepage must include the illustrated safety journey");
assertIncludes("index.html", "data-journey-step=\"3\"", "homepage safety journey must include the alert and safe-stop stage");
assertNotIncludes("index.html", "class=\"phone-wrap\"", "homepage must not retain the broken phone mockup");
assertIncludes("homepage.js", "prefers-reduced-motion: reduce", "homepage journey must honor reduced-motion preferences");
assertIncludes("homepage.js", "aria-selected", "homepage journey controls must expose their selected state");
assertIncludes("homepage.css", ".journey-scene{position:relative;height:340px;margin:14px -4px 10px;overflow:hidden", "homepage journey must clip its moving road inside the scene");
assertIncludes("homepage.css", ".journey-copy{position:relative;z-index:2", "homepage journey copy must stay above animated scene layers");
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
assertIncludes("sw.js", "'/homepage.css?v=31'", "service worker must cache the versioned homepage stylesheet");
assertNotIncludes("sw.js", "'/homepage.css',", "service worker must not recache the stale unversioned homepage stylesheet");
assertNotIncludes("sw.js", "'/homepage-journey-cinematic-v1.jpg'", "service worker install must not preload the large cinematic journey image");
assertIncludes("sw.js", "'/homepage.js'", "service worker must cache the external homepage behavior script");
assertIncludes("sw.js", "'/liquid-glass.css?v=3'", "service worker must cache the current shared Liquid Glass stylesheet");
assertNotIncludes("sw.js", "'/liquid-glass.css',", "service worker must not retain the stale unversioned Liquid Glass stylesheet");
for (const path of [
  "about.html",
  "accept-invite.html",
  "account.html",
  "app-ai-v3.html",
  "app-v2.html",
  "app.html",
  "driver-profiles.html",
  "faq.html",
  "features.html",
  "fleet-dashboard.html",
  "fleet-onboarding.html",
  "how-it-works.html",
  "install.html",
  "login.html",
  "pilot-leads.html",
  "pilot-signup.html",
  "privacy.html",
  "product-hub.html",
  "safety.html",
  "session-history.html",
]) {
  assertIncludes(path, '<link rel="stylesheet" href="/liquid-glass.css?v=3" />', `${path} must use the current shared Liquid Glass design layer`);
}
for (const accessibilityBoundary of [
  "prefers-reduced-transparency",
  "prefers-contrast: more",
  "prefers-reduced-motion: reduce",
  "@supports not ((backdrop-filter",
]) {
  assertIncludes("liquid-glass.css", accessibilityBoundary, `Liquid Glass must preserve the ${accessibilityBoundary} fallback`);
}
assertIncludes("app.html", "<link rel=\"stylesheet\" href=\"/driver-app.css\" />", "driver app must load its external stylesheet");
assertNotIncludes("app.html", "<style>", "driver app must keep its styles out of the HTML document");
assertIncludes("driver-app.css", "--overlay-dim", "driver app stylesheet must preserve display-intensity controls");
assertIncludes("sw.js", "'/driver-app.css'", "service worker must cache the external driver app stylesheet");
assertIncludes("vercel.json", "\"value\": \"no-store\"", "vercel.json must include no-store for sensitive helper files");
assertIncludes("vercel.json", "\"key\": \"Content-Security-Policy\"", "vercel.json must enforce its tested CSP");
assertIncludes("vercel.json", "https://fonts.googleapis.com", "vercel.json CSP must allow Google Fonts stylesheets used by marketing pages");
assertIncludes("vercel.json", "font-src 'self' https://fonts.gstatic.com", "vercel.json CSP must allow Google Fonts font files");
assertIncludes("vercel.json", "https://*.supabase.co", "vercel.json CSP must allow configured Supabase Auth requests");
assertIncludes("vercel.json", "publickey-credentials-create=(self)", "the production permissions policy must allow same-origin passkey enrollment");
assertIncludes("vercel.json", "publickey-credentials-get=(self)", "the production permissions policy must allow same-origin passkey sign-in");
assertIncludes("vercel.json", "\"source\": \"/occulert-backend.js\"", "browser auth helper must not be cached across configuration changes");
assertIncludes("vercel.json", "\"source\": \"/passkey-auth.js\"", "passkey client must not be cached across experimental API changes");
assertIncludes("vercel.json", "\"source\": \"/(.*).(js|css)\"", "unversioned homepage styles and scripts must be revalidated after deployment");
assertNotIncludes("occulert-backend.js", "PASTE_ANON_KEY_HERE", "browser backend client must not ship placeholder credentials");
assertIncludes("occulert-backend.js", "/api/public-config", "browser backend client must load public runtime configuration");
assertIncludes("occulert-backend.js", "redirect_to=", "signup confirmation emails must return users to the active Occulert site");
assertIncludes("occulert-backend.js", 'authFetch("/resend"', "signup confirmation emails must have a supported resend path");
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
assertIncludes("login.html", "id=\"passkeySignInBtn\"", "login must offer the supported passkey sign-in action");
assertIncludes("login.html", "id=\"passkeyStatus\"", "passkey results must appear beside the passkey action");
assertIncludes("login.html", "sign in with email and password first", "first-time passkey users must receive enrollment guidance");
assertIncludes("login.html", "src=\"/passkey-auth.js\"", "login must load the passkey client");
assertIncludes("passkey-auth.js", "experimental: { passkey: true }", "passkey support must be explicitly enabled in the Supabase client");
assertIncludes("passkey-auth.js", "signInWithPasskey", "passkey sign-in must use the Supabase WebAuthn implementation");
assertIncludes("auth-helper.js", "signInPasskey:signInPasskey", "the login helper must adopt authenticated passkey sessions");
assertIncludes("auth-helper.js", "await window.OcculertBackend.getSession()", "account-state rendering must validate or refresh the stored session before showing signed-in controls");
assertIncludes("login.html", "src=\"/supabase-loader.js\"", "login must use the resilient same-site Supabase loader");
assertIncludes("account.html", "src=\"/supabase-loader.js\"", "account settings must use the same resilient Supabase loader");
assertIncludes("supabase-loader.js", "var VERSION = \"2.112.3\"", "the resilient loader must pin a passkey-capable Supabase SDK version");
assertIncludes("supabase-loader.js", "sha384-l8ah+VgaWtk1mvOe9VC+OirC6qHFF4yH7l7mKRidV9MSti3E9F463bMp6ZVN4kuC", "every Supabase loader path must verify the pinned SDK integrity");
assertIncludes("supabase-loader.js", "/vendor/supabase-", "the Supabase loader must prefer the Occulert same-origin proxy");
assertIncludes("vercel.json", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/dist/umd/supabase.min.js", "the same-origin proxy must target the pinned SDK artifact");
assertIncludes("login.html", "id=\"passkeyRetryBtn\"", "login must offer recovery after a retryable Safari loader failure");
assertIncludes("account.html", "id=\"passkeyRetryBtn\"", "account settings must offer recovery after a retryable passkey setup failure");
assertIncludes("passkey-auth.js", "sdk_load_failed", "passkey errors must distinguish an SDK delivery failure");
assertIncludes("passkey-auth.js", "auth_config_unavailable", "passkey errors must distinguish unavailable runtime account settings");
assertIncludes("occulert-backend.js", "refreshAuthConfig", "passkey retry must be able to refresh a transient runtime configuration failure");
assertIncludes("login.html", "Passkey biometrics, PINs, and private keys stay", "login must disclose that passkey secrets stay with the user's authenticator");
assertNotIncludes("login.html", "onclick=\"googleAuth()\"", "login must not offer a nonfunctional Google action");
assertIncludes("login.html", "id=\"profileFields\" class=\"hidden\"", "sign-in must hide profile setup fields by default");
assertIncludes("login.html", "id=\"profileStateLabel\" tabindex=\"-1\">Account status", "signed-out login must not claim a signed-in profile");
assertIncludes("login.html", "Forgot password?", "login must offer password recovery");
assertIncludes("login.html", "If an Occulert account uses that email", "password recovery must not reveal whether an email is registered");
assertIncludes("login.html", "authMode==='signup'?extras():{}", "sign-in must not overwrite profile setup fields");
assertIncludes("login.html", "await backend.getFleet()", "signed-in role display must verify server-owned fleet access");
assertIncludes("login.html", "Verified owner of ", "verified fleet owners must receive a truthful manager status");
assertNotIncludes("login.html", "Manager invitation required", "login must not infer fleet access from the saved local role");
assertIncludes("occulert-backend.js", "\"/recover\" + passwordResetRedirect()", "password resets must go through Supabase Auth");
assertIncludes("occulert-backend.js", "params.get(\"type\") !== \"recovery\"", "auth redirects must accept recovery links only");
assertIncludes("occulert-backend.js", "window.history.replaceState", "recovery tokens must be removed from the visible URL");
assertIncludes("account.html", "OcculertBackend.consumeAuthRedirect", "account setup must verify recovery links before allowing a password change");
assertIncludes("fleet-onboarding.html", "createFleetInvitation", "fleet onboarding must create protected invitations through the API");
assertIncludes("fleet-onboarding.html", "resendFleetInvitation", "fleet onboarding must support replacing pending invitation links");
assertIncludes("fleet-onboarding.html", "mailto:", "fleet onboarding must support no-cost sharing through the manager's mail app");
assertIncludes("fleet-onboarding.html", "Copy Link", "fleet onboarding must preserve a copy-link fallback");
assertIncludes("accept-invite.html", "history.replaceState", "invite pages must immediately remove tokens from the visible URL");
assertIncludes("accept-invite.html", "sessionStorage", "invite tokens must stay out of persistent local storage");
assertIncludes("accept-invite.html", ".hidden{display:none!important}", "invite success actions must remain hidden until acceptance succeeds");
assertIncludes("accept-invite.html", "OcculertBackend.authMessage", "invite auth failures must show actionable messages");
assertIncludes("accept-invite.html", "Resend Confirmation", "invite signup must recover when the confirmation email is missing");
assertIncludes("accept-invite.html", "Forgot Password?", "invite signup must recover when the invited email already has an account");
assertIncludes("accept-invite.html", "setAuthBusy(true)", "invite auth actions must prevent duplicate in-flight requests");
assertNotIncludes("app.html", "oninput=\"typeof setSensitivity", "driver app must not keep the conflicting numeric sensitivity slider");
for (const path of ["features.html", "how-it-works.html", "install.html"]) assertSingleH1(path);
assertIncludes("account.html", "function esc(v)", "account.html must escape rendered profile fields");
assertIncludes("account.html", "OcculertBackend.updateEmail", "account email changes must go through Supabase Auth");
assertIncludes("account.html", "OcculertBackend.updatePassword", "account password changes must go through Supabase Auth");
assertIncludes("account.html", "id=\"registerPasskeyBtn\"", "signed-in account settings must offer passkey enrollment");
assertIncludes("account.html", "data-passkey-action=\"remove\"", "account settings must allow users to revoke their own passkeys");
assertIncludes("account.html", "Keep password recovery available as a backup", "passkey enrollment must preserve the recovery fallback");
assertIncludes("passkey-auth.js", "client.auth.registerPasskey", "passkey registration must use the authenticated Supabase ceremony");
assertIncludes("passkey-auth.js", "client.auth.passkey.delete", "passkey deletion must use the authenticated Supabase account API");
assertIncludes("passkey-auth.js", "signOut({ scope: \"local\" })", "sign-out must clear the passkey SDK's current browser session without signing out other devices");
assertIncludes("sw.js", "'/passkey-auth.js'", "the service worker must keep the passkey client network-only");
assertIncludes("sw.js", "'/supabase-loader.js'", "the service worker must keep the resilient Supabase loader network-only");
const serviceWorker = read("sw.js");
const staticAssets = serviceWorker.slice(serviceWorker.indexOf("const STATIC_ASSETS"), serviceWorker.indexOf("];", serviceWorker.indexOf("const STATIC_ASSETS")) + 2);
const networkOnlyAssets = serviceWorker.slice(serviceWorker.indexOf("const NETWORK_ONLY_ASSETS"), serviceWorker.indexOf("]);", serviceWorker.indexOf("const NETWORK_ONLY_ASSETS")) + 3);
const staticAssetPaths = [...staticAssets.matchAll(/'([^']+)'/g)].map((match) => match[1]);
const staticAssetBytes = staticAssetPaths.reduce((total, asset) => {
  const pathname = asset.split(/[?#]/, 1)[0];
  const file = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  return total + statSync(join(root, file)).size;
}, 0);
if (staticAssetBytes > 300_000) fail(`service worker install cache must remain at or below 300 KB (found ${staticAssetBytes} bytes)`);
if (staticAssets.includes("'/passkey-auth.js'")) fail("the experimental passkey client must not be stored in the offline static cache");
if (!networkOnlyAssets.includes("'/passkey-auth.js'")) fail("the passkey client must be listed as a network-only asset");
if (staticAssets.includes("'/supabase-loader.js'")) fail("the resilient Supabase loader must not be stored in the offline static cache");
if (!networkOnlyAssets.includes("'/supabase-loader.js'")) fail("the resilient Supabase loader must be listed as a network-only asset");
assertIncludes("privacy.html", "passkey private key stay with your device", "privacy terms must disclose that Occulert does not receive passkey private keys or biometrics");
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
assertIncludes("native-app/lib/appBuildInfo.ts", "formatAppBuildLabel", "native build metadata must expose a reusable display label");
assertIncludes("native-app/lib/feedback.ts", "Build number:", "native session feedback must include the recorded native build number");
assertIncludes("native-app/app/settings.tsx", "formatAppBuildLabel(currentAppBuildInfo())", "native Settings must display the installed app version and build");
assertNotIncludes("native-app/app/settings.tsx", "Occulert™ · v1.0.0", "native Settings must not hardcode the displayed app version");
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
assertIncludes("native-app/components/AlertSystem.tsx", "alertDeliveryPlan", "native alert outputs must use the bounded severity plan");
assertIncludes("native-app/components/AlertSystem.tsx", "cancelPendingCues", "native alert output sequences must cancel stale timers");
assertIncludes("native-app/app/settings.tsx", "centered three-tone critical sequence", "native Settings must explain the parked urgent audio test");
assertIncludes("native-app/targets/occulert-watch/AlertReceiver.swift", "playCriticalHapticSequence", "the Watch must use the stronger critical wrist sequence");
assertIncludes("native-app/targets/occulert-watch/AlertReceiver.swift", "hapticSequenceTask?.cancel()", "the Watch must replace a pending haptic sequence when a newer alert arrives");
assertIncludes("native-app/app/settings.tsx", "watchTestRunnerRef.current.run", "the parked Watch test must reject overlapping sends");
assertIncludes("liquid-glass.css", ":where(:root) :where(.notice", "shared semantic surfaces must preserve page-level status colors");
assertIncludes("liquid-glass.css", "[data-theme=\"light\"] :where(.status.show.bad)", "light-theme error status text must retain accessible contrast");
assertIncludes("liquid-glass.css", "html[data-theme=\"light\"] .dashboard-page .privacy-note", "light-theme fleet privacy warnings must retain accessible contrast");
assertIncludes("liquid-glass.css", "html[data-theme=\"light\"] .dashboard-page #cloudStatus", "light-theme fleet connection status must retain accessible contrast");
assertNotIncludes("liquid-glass.css", "backdrop-filter: blur(14px) saturate(135%)", "mobile content cards must not restore expensive backdrop blur");
assertIncludes("APP_ROADMAP.md", "Open one draft pull request only after explicit approval.\n3. Perform a focused review", "the roadmap must open the draft before reviewing its complete PR diff");
assertNotIncludes("features.html", "designed to actually wake you up", "public alert copy must not imply that alerts make drowsy driving safe");
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
assertIncludes("fleet-dashboard.html", "ontoggle=\"handleHistoryToggle(event)\"", "protected session history must render only after the manager opens it");
assertNotIncludes("fleet-dashboard.html", "class=\"panel-details history-details\" open", "protected session history must start collapsed");
assertIncludes("fleet-dashboard.html", "function refreshDashboardIfNeeded()", "fleet dashboard polling must skip unchanged full-page renders");
assertIncludes("fleet-dashboard.html", "setInterval(refreshDashboardIfNeeded,3000)", "fleet dashboard must use the focus-stable refresh path");
assertNotIncludes("fleet-dashboard.html", "setInterval(render,3000)", "fleet dashboard must not rebuild interactive controls every three seconds");
assertIncludes("fleet-dashboard.html", "function queueDriverListRender()", "fleet dashboard filtering must update only the driver list");
assertIncludes("fleet-dashboard.html", "document.hidden", "fleet dashboard polling must pause while the page is hidden");
assertIncludes("fleet-dashboard.html", "protectedFleetLoading", "fleet dashboard must prevent overlapping protected-summary requests");
assertIncludes("fleet-dashboard.html", "data-focus-key=\"driver-copy-", "dynamic driver actions must expose stable focus keys");
assertIncludes("fleet-dashboard.html", "function exportSessionHistoryCSV()", "protected session history must keep a privacy-safe export");
assertIncludes("fleet-dashboard.html", "OcculertSecurity.csvCell", "fleet exports must neutralize spreadsheet formulas");
assertIncludes("fleet-dashboard.html", "aria-label=\"Fleet navigation\"", "fleet dashboards must keep explicit navigation controls");
assertIncludes("fleet-dashboard.html", "id=\"fleetPrimaryNav\"", "fleet navigation must expose one contextual primary action");
assertIncludes("fleet-dashboard.html", "await backend.getSession()", "fleet navigation must validate or refresh the stored session before showing manager controls");
assertIncludes("fleet-dashboard.html", "id=\"signedOutActions\"", "signed-out fleet dashboards must offer immediate recovery actions");
assertIncludes("fleet-dashboard.html", "href=\"/login.html\">Sign In", "fleet dashboards must provide a direct sign-in path");
assertIncludes("sw.js", "const CACHE = 'occulert-v40'", "the dashboard and design update must advance the offline cache");
assertIncludes("sw.js", "'/portal.css?v=6'", "the service worker must cache the current shared portal stylesheet");
assertNotIncludes("sw.js", "occulert-v39", "the dashboard and design update must not reuse the stale offline cache");
assertNotIncludes("sw.js", "'/portal.css?v=5'", "the service worker must not retain the stale portal stylesheet URL");
for (const asset of ["'/occulert-logo-alt.png'", "'/occulert-logo.png'", "'/occulert-logo-main.png'"]) {
  if (staticAssets.includes(asset)) fail(`service worker install cache must not preload ${asset}`);
}
assertIncludes("portal.css", "background: var(--portal-surface);", "portal cards must follow the active light or dark theme");
assertIncludes("portal.css", 'html[data-theme="light"] .portal-page .btn:not(.primary):hover', "light-theme button hover states must preserve readable contrast");
assertNotIncludes("portal.css", "background: rgba(14, 26, 45, .94);", "portal cards must not force a dark surface in light mode");
assertIncludes("portal.css", "--portal-accent-text: #245da8;", "light-theme portal labels must use a readable accent color");
assertIncludes("portal.css", "--portal-icon-text: #26354a;", "light-theme portal icons must remain visible on tinted surfaces");
assertIncludes("portal.css", "color: var(--portal-accent-text);", "portal labels must follow the active theme accent");
assertIncludes("portal.css", "color: var(--portal-icon-text);", "portal icons must follow the active theme text token");
for (const path of ["login.html", "fleet-dashboard.html", "fleet-onboarding.html", "account.html", "product-hub.html"]) {
  assertIncludes(path, '<link rel="stylesheet" href="/portal.css?v=6" />', `${path} must use the current simplified portal design layer`);
  assertNotIncludes(path, '<link rel="stylesheet" href="/portal.css?v=5" />', `${path} must not reuse the stale portal stylesheet`);
  assertIncludes(path, "portal-page", `${path} must opt into the simplified portal layout`);
}
assertIncludes("fleet-dashboard.html", "Needs attention", "fleet managers must see the action-focused heading first");
assertIncludes("fleet-dashboard.html", "Dashboard tools", "secondary dashboard actions must be grouped away from the primary overview");
assertIncludes("fleet-dashboard.html", "More fleet tools", "secondary fleet operations must use progressive disclosure");
assertIncludes("fleet-dashboard.html", "Saved driver profiles", "signed-out fleet summaries must distinguish saved profiles from local sessions");
assertIncludes("fleet-dashboard.html", "Local sessions", "signed-out fleet summaries must label same-browser sessions directly");
assertIncludes("fleet-dashboard.html", "Fresh now", "signed-out fleet summaries must avoid presenting a raw session count as fleet coverage");
assertIncludes("login.html", "Privacy and account security", "sign-in privacy details must remain available without dominating the form");
assertIncludes("login.html", "id=\"authCard\"", "signed-in continuation must be able to hide the redundant authentication form");
assertIncludes("login.html", "id=\"profileStateLabel\" tabindex=\"-1\"", "signed-in continuation must accept programmatic focus");
assertIncludes("login.html", "focusSignInContinuation()", "interactive sign-in must hand focus to the continuation state");
assertIncludes("login.html", "focusSignInForm()", "account switching must return focus to the sign-in form");
assertIncludes("login.html", "setSignedInLayout(Boolean(user)&&authMode==='signin')", "signed-in continuation must depend on an active authenticated user");
assertIncludes("login.html", "href=\"/account.html\">Account</a>", "signed-in users must receive a direct Account action");
assertIncludes("login.html", "Use another account", "signed-in users must receive an explicit account-switch action");
assertNotIncludes("login.html", "Account Setup →", "passkey guidance must use the current Account label");
assertIncludes("account.html", "await backend.getFleet()", "account access must verify server-owned fleet access");
assertIncludes("account.html", "Verified role", "account summaries must label the server-authoritative role");
assertIncludes("account.html", "Local app role", "account summaries must distinguish device-only role preferences");
assertIncludes("account.html", "class=\"grid account-grid\"", "account settings must expose the responsive account hierarchy");
assertIncludes("account.html", "class=\"account-access\"", "verified Account access must be a separately orderable region");
assertIncludes("account.html", "Driver app settings", "device-only settings must use a clear driver-app label");
assertIncludes("portal.css", '"access settings"\n    "secondary settings"', "desktop Account layout must follow its keyboard and screen-reader order");
assertIncludes("account.html", ".grid>*{min-width:0}", "account columns must allow long verified fleet names to shrink on mobile");
assertIncludes("account.html", "overflow-wrap:anywhere", "account access values must wrap long server-provided text");
assertNotIncludes("account.html", "document.getElementById('continueBtn').href=(p.role==='fleet')", "account navigation must not trust a saved local role for fleet access");
assertIncludes("fleet-dashboard.html", "Protected fleet summaries exclude GPS coordinates by design", "fleet dashboard must disclose that protected summaries exclude GPS coordinates");
assertIncludes("fleet-dashboard.html", "same-browser local data", "fleet dashboard metadata must scope GPS to same-browser local data");
assertIncludes("fleet-dashboard.html", "Local GPS Drivers", "fleet dashboard must label GPS metrics as local-only");
assertIncludes("fleet-dashboard.html", "rowHtml('Local GPS shared'", "fleet dashboard coverage must label same-browser GPS as local-only");
assertIncludes("fleet-dashboard.html", "no local GPS consent", "fleet dashboard actions must describe missing same-browser GPS consent accurately");
assertIncludes("fleet-dashboard.html", "#actionQueue .ops-row{grid-template-columns:1fr;gap:4px}", "fleet dashboard action messages must preserve the current non-overlapping layout");
assertIncludes("fleet-dashboard.html", "id=\"accountNav\"", "signed-in fleet navigation must expose Account directly");
assertIncludes("fleet-dashboard.html", "Manage drivers", "the roster action must name the object it manages");
assertIncludes("fleet-dashboard.html", "Fleet setup", "fleet onboarding must have a distinct navigation label");
assertIncludes("fleet-dashboard.html", "class=\"dashboard-content\"", "fleet dashboard sections must support a mobile-specific content order");
assertIncludes("fleet-dashboard.html", "class=\"grid dashboard-kpis\"", "fleet summary metrics must remain a distinct responsive region");
const fleetDashboardMarkup = read("fleet-dashboard.html");
if (!(fleetDashboardMarkup.indexOf('class="main"') < fleetDashboardMarkup.indexOf('class="grid dashboard-kpis"')
  && fleetDashboardMarkup.indexOf('class="grid dashboard-kpis"') < fleetDashboardMarkup.indexOf('class="panel-details fleet-tools"'))) {
  fail("fleet dashboard DOM order must place Driver Status before summary metrics and secondary tools");
}
assertNotIncludes("fleet-dashboard.html", "View driver fatigue scores, GPS locations", "fleet dashboard metadata must not advertise protected GPS locations");
assertNotIncludes("fleet-dashboard.html", "GPS and cloud sync only appear when the driver enables them", "fleet dashboard must not imply protected fleet summaries include opted-in GPS");
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
