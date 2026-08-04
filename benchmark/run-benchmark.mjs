import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const THRESHOLDS = { low: 0.15, medium: 0.18, high: 0.21 };
const DROWSY_LABELS = new Set(["drowsy", "high_fatigue", "sleepy"]);

// Accepts the minimal `label,ear` shape and the richer canonical shape emitted by
// prepare-dataset.mjs (label,ear,participant,clip,split,<slices...>). Extra
// columns are preserved so results can be sliced without a second parse.
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
    const row = { label: cells[labelIndex].toLowerCase(), ear };
    headers.forEach((header, position) => {
      if (position !== labelIndex && position !== earIndex) row[header] = cells[position] ?? "";
    });
    return row;
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

export function selectSplit(rows, split) {
  if (!split) return rows;
  if (!rows.some((row) => "split" in row)) {
    throw new Error(`--split ${split} requested but the CSV has no split column. Run prepare-dataset.mjs first.`);
  }
  return rows.filter((row) => row.split === split);
}

export function runSliced(rows, column) {
  const groups = new Map();
  for (const row of rows) {
    const key = row[column] === undefined || row[column] === "" ? "(unspecified)" : row[column];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups].sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([key, group]) => [key, { samples: group.length, results: run(group) }]));
}

// A result with no provenance is not reproducible, so this is not optional.
export function provenance({ input, split, dataset }) {
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // Running outside a checkout is allowed; the field stays "unknown".
  }
  return {
    runnerCommit: commit,
    thresholds: THRESHOLDS,
    input: input ?? null,
    split: split ?? "all",
    dataset: dataset ?? null,
    ranAt: new Date().toISOString(),
  };
}

function percent(value) { return `${(value * 100).toFixed(1)}%`; }

function table(results) {
  const lines = [
    "Sensitivity | Precision | Recall | F1 | False alert rate",
    "------------|-----------|--------|----|-----------------",
  ];
  for (const [name, result] of Object.entries(results)) {
    lines.push(`${name.padEnd(11)} | ${percent(result.precision).padEnd(9)} | ${percent(result.recall).padEnd(6)} | ${percent(result.f1).padEnd(5)} | ${percent(result.falseAlertRate)}`);
  }
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? undefined : process.argv[index + 1];
  };
  const input = arg("--input");
  if (!input) {
    console.error("Usage: node benchmark/run-benchmark.mjs --input labeled-ear.csv [--split test] [--slice-by lighting] [--dataset name@version] [--json results.json]");
    process.exit(2);
  }

  const split = arg("--split");
  const sliceBy = arg("--slice-by");
  const dataset = arg("--dataset");
  const jsonOut = arg("--json");

  const allRows = parseCsv(await readFile(input, "utf8"));
  const rows = selectSplit(allRows, split);
  if (!rows.length) {
    console.error(`No rows matched${split ? ` split "${split}"` : ""}.`);
    process.exit(1);
  }

  const meta = provenance({ input, split, dataset });
  const overall = run(rows);
  const slices = sliceBy ? runSliced(rows, sliceBy) : null;

  console.log(table(overall));
  if (slices) {
    for (const [key, group] of Object.entries(slices)) {
      console.log(`\nSlice ${sliceBy} = ${key}  (${group.samples} samples)`);
      console.log(table(group.results));
    }
  }

  console.log(`\n${rows.length} of ${allRows.length} labeled EAR samples evaluated (split: ${meta.split}).`);
  console.log(`Runner commit ${meta.runnerCommit}${dataset ? `, dataset ${dataset}` : ""}.`);
  console.log("Frame-level EAR threshold benchmark only. Not a clinical, full-pipeline, or on-road validation.");

  if (jsonOut) {
    await writeFile(jsonOut, `${JSON.stringify({ provenance: meta, samples: rows.length, overall, slices }, null, 2)}\n`, "utf8");
    console.log(`Wrote ${jsonOut}.`);
  }
}
