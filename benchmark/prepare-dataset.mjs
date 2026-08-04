// Turns a raw, licensed dataset export into the canonical Occulert benchmark CSV.
//
// It does three governance jobs that must not be done by hand:
//   1. maps source labels onto awake / drowsy / high_fatigue
//   2. drops excluded frames and keeps a tally of why
//   3. assigns a train/test split at participant level, so no two frames of the
//      same person can land on both sides of the split
//
// It never copies raw media. Input and output are tabular derived values only.

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const CANONICAL_LABELS = new Set(["awake", "drowsy", "high_fatigue"]);

export function parseDelimited(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines.shift().split(",").map((value) => value.trim());
  const rows = lines.filter(Boolean).map((line) => {
    const cells = line.split(",").map((value) => value.trim());
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
  return { headers, rows };
}

export function toCsv(headers, rows) {
  const escape = (value) => {
    const text = value === undefined || value === null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\n");
}

// Deterministic and seed-stable: the same participant always lands in the same
// split for a given seed, so a split can be reproduced without shipping it.
export function assignSplit(key, seed, testFraction) {
  const digest = createHash("sha256").update(`${seed}:${key}`).digest();
  const unit = digest.readUInt32BE(0) / 0x1_00_00_00_00;
  return unit < testFraction ? "test" : "train";
}

// `exclude.when[].column` and `labelColumn` both name columns in the RAW export,
// because exclusions are applied before any label mapping happens.
export function shouldExclude(row, exclude = {}, labelColumn = "label") {
  const labels = new Set((exclude.labels ?? []).map((value) => String(value).toLowerCase()));
  const rawLabel = row[labelColumn];
  if (labels.size && rawLabel !== undefined && labels.has(String(rawLabel).toLowerCase())) {
    return `excluded label: ${rawLabel}`;
  }
  for (const rule of exclude.when ?? []) {
    const value = row[rule.column];
    if (rule.missing && (value === undefined || value === "")) {
      return rule.reason ?? `missing ${rule.column}`;
    }
    if (rule.equals !== undefined && value !== undefined && String(value) === String(rule.equals)) {
      return rule.reason ?? `${rule.column} == ${rule.equals}`;
    }
  }
  return null;
}

export function prepare(rawRows, config) {
  const columns = config.columns ?? {};
  const labelMap = config.labelMap ?? {};
  const slices = config.slices ?? {};
  const split = { by: "participant", testFraction: 0.3, seed: "occulert", ...(config.split ?? {}) };

  const kept = [];
  const exclusions = new Map();
  const note = (reason) => exclusions.set(reason, (exclusions.get(reason) ?? 0) + 1);

  const labelColumn = columns.label ?? "label";

  for (const raw of rawRows) {
    const excluded = shouldExclude(raw, config.exclude, labelColumn);
    if (excluded) {
      note(excluded);
      continue;
    }

    const sourceLabel = raw[columns.label ?? "label"];
    const label = labelMap[sourceLabel] ?? String(sourceLabel ?? "").toLowerCase();
    if (!CANONICAL_LABELS.has(label)) {
      note(`unmapped label: ${sourceLabel}`);
      continue;
    }

    const ear = Number(raw[columns.ear ?? "ear"]);
    if (!Number.isFinite(ear)) {
      note("non-numeric EAR");
      continue;
    }

    const participant = String(raw[columns.participant ?? "participant"] ?? "").trim();
    if (!participant) {
      note("missing participant id");
      continue;
    }

    const row = {
      label,
      ear,
      participant,
      clip: raw[columns.clip ?? "clip"] ?? "",
      split: assignSplit(participant, split.seed, split.testFraction),
    };
    for (const [sliceName, sourceColumn] of Object.entries(slices)) {
      row[sliceName] = raw[sourceColumn] ?? "";
    }
    kept.push(row);
  }

  const participants = new Map();
  for (const row of kept) participants.set(row.participant, row.split);
  const testParticipants = [...participants].filter(([, s]) => s === "test").map(([p]) => p);
  const trainParticipants = [...participants].filter(([, s]) => s === "train").map(([p]) => p);

  const headers = ["label", "ear", "participant", "clip", "split", ...Object.keys(slices)];
  const manifest = {
    dataset: config.dataset ?? {},
    split: { ...split, testParticipants: testParticipants.length, trainParticipants: trainParticipants.length },
    counts: {
      rawRows: rawRows.length,
      keptRows: kept.length,
      excludedRows: rawRows.length - kept.length,
      byLabel: kept.reduce((acc, row) => ({ ...acc, [row.label]: (acc[row.label] ?? 0) + 1 }), {}),
      bySplit: kept.reduce((acc, row) => ({ ...acc, [row.split]: (acc[row.split] ?? 0) + 1 }), {}),
    },
    exclusions: Object.fromEntries(exclusions),
    leakageCheck: {
      participantsInBothSplits: [...participants.keys()].filter((p) => {
        const rows = kept.filter((row) => row.participant === p);
        return new Set(rows.map((row) => row.split)).size > 1;
      }),
    },
    preparedAt: new Date().toISOString(),
  };

  return { headers, rows: kept, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? undefined : process.argv[index + 1];
  };
  const input = arg("--input");
  const configPath = arg("--config");
  const output = arg("--output") ?? "benchmark-ear.csv";
  if (!input || !configPath) {
    console.error("Usage: node benchmark/prepare-dataset.mjs --config dataset-config.json --input raw.csv [--output benchmark-ear.csv]");
    process.exit(2);
  }

  const config = JSON.parse(await readFile(configPath, "utf8"));
  const { rows: rawRows } = parseDelimited(await readFile(input, "utf8"));
  const { headers, rows, manifest } = prepare(rawRows, config);

  if (manifest.leakageCheck.participantsInBothSplits.length) {
    console.error("Participant leakage detected across splits:", manifest.leakageCheck.participantsInBothSplits);
    process.exit(1);
  }

  await writeFile(output, `${toCsv(headers, rows)}\n`, "utf8");
  await writeFile(`${output.replace(/\.csv$/, "")}-manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Kept ${manifest.counts.keptRows} of ${manifest.counts.rawRows} rows.`);
  console.log(`Excluded ${manifest.counts.excludedRows}:`);
  for (const [reason, count] of Object.entries(manifest.exclusions)) console.log(`  ${count.toString().padStart(7)}  ${reason}`);
  console.log(`Split by ${manifest.split.by}: ${manifest.split.trainParticipants} train / ${manifest.split.testParticipants} test participants.`);
  console.log(`Wrote ${output} and ${output.replace(/\.csv$/, "")}-manifest.json. Keep both outside the repository if the license requires it.`);
}
