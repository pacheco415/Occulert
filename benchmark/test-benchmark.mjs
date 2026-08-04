import assert from "node:assert/strict";
import { parseCsv, run, runSliced, selectSplit, provenance, THRESHOLDS } from "./run-benchmark.mjs";
import { prepare, assignSplit, shouldExclude, parseDelimited, toCsv, CANONICAL_LABELS } from "./prepare-dataset.mjs";

// --- scoring (unchanged contract) ------------------------------------------

const rows = parseCsv(`label,ear
awake,0.30
awake,0.25
awake,0.17
drowsy,0.13
drowsy,0.16
drowsy,0.20`);
const results = run(rows);

assert.equal(results.low.tp, 1);
assert.equal(results.low.fp, 0);
assert.equal(results.medium.tp, 2);
assert.equal(results.medium.fp, 1);
assert.equal(results.high.tp, 3);
assert.equal(results.high.fp, 1);
assert.ok(results.medium.recall > results.low.recall);

// --- extra columns survive parsing -----------------------------------------

const rich = parseCsv(`label,ear,participant,split,lighting
awake,0.30,p1,train,day
drowsy,0.12,p1,train,day
awake,0.29,p2,test,night
drowsy,0.11,p2,test,night`);

assert.equal(rich[0].participant, "p1");
assert.equal(rich[2].lighting, "night");

// --- split selection --------------------------------------------------------

assert.equal(selectSplit(rich, "test").length, 2);
assert.equal(selectSplit(rich, undefined).length, 4);
assert.throws(() => selectSplit(rows, "test"), /no split column/);

// --- slicing ----------------------------------------------------------------

const sliced = runSliced(rich, "lighting");
assert.deepEqual(Object.keys(sliced).sort(), ["day", "night"]);
assert.equal(sliced.day.samples, 2);
assert.equal(sliced.night.results.medium.tp, 1);

const unspecified = runSliced(parseCsv("label,ear\nawake,0.3"), "eyewear");
assert.ok("(unspecified)" in unspecified, "missing slice values are labelled, not dropped");

// --- provenance -------------------------------------------------------------

const meta = provenance({ input: "x.csv", split: "test", dataset: "demo@1" });
assert.equal(meta.split, "test");
assert.equal(meta.dataset, "demo@1");
assert.deepEqual(meta.thresholds, THRESHOLDS);
assert.ok(meta.ranAt, "results must carry a timestamp");
assert.ok(meta.runnerCommit, "results must carry a runner commit");

// --- deterministic, leak-free splits ----------------------------------------

assert.equal(assignSplit("p1", "seed-a", 0.3), assignSplit("p1", "seed-a", 0.3));
assert.ok(["train", "test"].includes(assignSplit("p1", "seed-a", 0.3)));
assert.equal(assignSplit("p1", "seed-a", 0), "train", "testFraction 0 sends everyone to train");
assert.equal(assignSplit("p1", "seed-a", 1), "test", "testFraction 1 sends everyone to test");

// --- exclusions -------------------------------------------------------------

const exclude = {
  labels: ["unknown"],
  when: [
    { column: "face_detected", equals: "0", reason: "no face detected" },
    { column: "ear", missing: true, reason: "missing EAR" },
  ],
};
assert.equal(shouldExclude({ label: "awake", face_detected: "1", ear: "0.3" }, exclude), null);
assert.equal(shouldExclude({ label: "awake", face_detected: "0", ear: "0.3" }, exclude), "no face detected");
assert.equal(shouldExclude({ label: "awake", face_detected: "1", ear: "" }, exclude), "missing EAR");
assert.match(shouldExclude({ label: "unknown", face_detected: "1", ear: "0.3" }, exclude), /excluded label/);

// A slice value that merely looks like an excluded label must not drop the row:
// only the label column is checked.
assert.equal(shouldExclude({ label: "awake", lighting: "unknown", face_detected: "1", ear: "0.3" }, exclude), null);

// --- end-to-end preparation --------------------------------------------------

const config = {
  dataset: { name: "demo", version: "1" },
  columns: { label: "state", ear: "ear_value", participant: "subject", clip: "video" },
  labelMap: { 0: "awake", 1: "drowsy", 2: "high_fatigue" },
  // Exclusion rules name RAW columns, which in this dataset are `ear_value`
  // and `state`, not the canonical names.
  exclude: {
    labels: ["unknown"],
    when: [
      { column: "face_detected", equals: "0", reason: "no face detected" },
      { column: "ear_value", missing: true, reason: "missing EAR" },
    ],
  },
  slices: { lighting: "light" },
  split: { by: "participant", testFraction: 0.5, seed: "occulert-test" },
};

const raw = parseDelimited(`subject,video,state,ear_value,face_detected,light
s1,v1,0,0.31,1,day
s1,v1,1,0.12,1,day
s2,v2,2,0.14,1,night
s2,v2,0,0.29,1,night
s3,v3,0,0.30,0,day
s3,v3,unknown,0.28,1,day
s4,v4,9,0.20,1,day
s5,v5,0,,1,day`).rows;

const prepared = prepare(raw, config);

assert.equal(prepared.rows.length, 4, "only the four clean, mappable rows survive");
assert.equal(prepared.manifest.counts.excludedRows, 4);
assert.deepEqual(prepared.manifest.leakageCheck.participantsInBothSplits, [], "no participant may span splits");
assert.ok(prepared.manifest.exclusions["no face detected"] >= 1);
assert.ok(Object.keys(prepared.manifest.exclusions).some((key) => key.startsWith("unmapped label")), "label 9 is unmapped, not silently kept");
assert.ok(Object.values(prepared.manifest.exclusions).includes(1));
assert.deepEqual(prepared.headers, ["label", "ear", "participant", "clip", "split", "lighting"]);
assert.ok(prepared.rows.every((row) => CANONICAL_LABELS.has(row.label)));

// Every row of a given participant carries that participant's single split.
const splitsByParticipant = new Map();
for (const row of prepared.rows) {
  const seen = splitsByParticipant.get(row.participant);
  if (seen) assert.equal(row.split, seen, `participant ${row.participant} leaked across splits`);
  splitsByParticipant.set(row.participant, row.split);
}

// The prepared output must round-trip straight back into the runner.
const roundTripped = parseCsv(toCsv(prepared.headers, prepared.rows));
assert.equal(roundTripped.length, prepared.rows.length);
assert.ok(roundTripped.every((row) => ["train", "test"].includes(row.split)));
run(roundTripped);

console.log("Occulert benchmark runner and dataset-preparation tests passed.");
