import assert from "node:assert/strict";
import { parseCsv, run } from "./run-benchmark.mjs";

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

console.log("Occulert benchmark runner tests passed.");
