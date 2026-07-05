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

walk(root);

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
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
assertIncludes("vercel.json", "Content-Security-Policy-Report-Only", "vercel.json must include CSP report-only hardening");
assertIncludes("account.html", "function esc(v)", "account.html must escape rendered profile fields");
assertIncludes("native-app/components/AlertSystem.tsx", "../assets/alert.wav", "native alert sound must be bundled locally");
assertIncludes("fleet-dashboard.html", "id=\"driverSearch\"", "fleet dashboard must keep driver search controls");
assertIncludes("fleet-dashboard.html", "function exportFleetCSV()", "fleet dashboard must keep CSV export");
assertIncludes("fleet-dashboard.html", "function seedDemoData()", "fleet dashboard must keep demo data loading");
assertIncludes("fleet-dashboard.html", "function copyDriver(id)", "fleet dashboard must keep per-driver copy summaries");

if (failures.length) {
  console.error("Occulert site audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Occulert site audit passed (${htmlFiles.length} HTML files checked).`);
