import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function contentSha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

// Resolve the checkout from the scripts, not the caller's working directory.
// A commit alone cannot identify edited scripts, so retain their exact hashes.
export function sourceSnapshot() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files = ["run-benchmark.mjs", "prepare-dataset.mjs", "csv.mjs", "provenance.mjs"];
  const sourceHashes = Object.fromEntries(files.map(name => [
    `benchmark/${name}`, contentSha256(readFileSync(new URL(name, import.meta.url))),
  ]));
  let runnerCommit = "unknown", sourceDirty = null;
  try {
    runnerCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    sourceDirty = execFileSync("git", ["status", "--porcelain", "--", ...files.map(name => `benchmark/${name}`)], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() !== "";
  } catch {
    // The hashes still identify the scripts when running without Git metadata.
  }
  return { runnerCommit, sourceDirty, sourceHashes };
}
