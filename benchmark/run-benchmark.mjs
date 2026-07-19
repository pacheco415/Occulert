import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const THRESHOLDS = { low: 0.15, medium: 0.18, high: 0.21 };
const DROWSY_LABELS = new Set(["drowsy", "high_fatigue", "sleepy"]);

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",").map((value) => value.trim().toLowerCase());
  const labelIndex = headers.indexOf("label");
  const earIndex = headers.indexOf("ear");
  if (labelIndex < 0 || earIndex < 0) throw new Error("CSV must contain label and ear columns");
  return lines.filter(Boolean).map((line, index) => {
    const cells = line.split(",").map((value) => value.trim());
    const ear = Number(cells[earIndex]);
    if (!Number.isFinite(ear)) throw new Error(`Invalid EAR value on row ${index + 2}`);
    return { label: cells[labelIndex].toLowerCase(), ear };
  });
}

export function score(rows, threshold) {
  const counts = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const row of rows) {
    const actual = DROWSY_LABELS.has(row.label);
    const predicted = row.ear < threshold;
    if (actual && predicted) counts.tp += 1;
    else if (!actual && predicted) counts.fp += 1;
    else if (!actual) counts.tn += 1;
    else counts.fn += 1;
  }
  const precision = counts.tp / Math.max(1, counts.tp + counts.fp);
  const recall = counts.tp / Math.max(1, counts.tp + counts.fn);
  const f1 = (2 * precision * recall) / Math.max(Number.EPSILON, precision + recall);
  const falseAlertRate = counts.fp / Math.max(1, counts.fp + counts.tn);
  return { ...counts, precision, recall, f1, falseAlertRate };
}

export function run(rows) {
  return Object.fromEntries(Object.entries(THRESHOLDS).map(([name, threshold]) => [name, score(rows, threshold)]));
}

function percent(value) { return `${(value * 100).toFixed(1)}%`; }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const inputIndex = process.argv.indexOf("--input");
  if (inputIndex < 0 || !process.argv[inputIndex + 1]) {
    console.error("Usage: node benchmark/run-benchmark.mjs --input labeled-ear.csv");
    process.exit(2);
  }
  const rows = parseCsv(await readFile(process.argv[inputIndex + 1], "utf8"));
  const results = run(rows);
  console.log("Sensitivity | Precision | Recall | F1 | False alert rate");
  console.log("------------|-----------|--------|----|-----------------");
  for (const [name, result] of Object.entries(results)) {
    console.log(`${name.padEnd(11)} | ${percent(result.precision).padEnd(9)} | ${percent(result.recall).padEnd(6)} | ${percent(result.f1).padEnd(5)} | ${percent(result.falseAlertRate)}`);
  }
  console.log(`\n${rows.length} labeled EAR samples evaluated. This is a frame-level threshold benchmark, not a clinical or full-pipeline validation.`);
}
