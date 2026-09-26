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
import { parseTable, validEar } from "./csv.mjs";
import { contentSha256, sourceSnapshot } from "./provenance.mjs";

export const CANONICAL_LABELS = new Set(["awake", "drowsy", "high_fatigue"]);
const CANONICAL_COLUMNS = new Set(["label", "ear", "participant", "clip", "split"]);

export function parseDelimited(text) {
  return parseTable(text);
}

export function toCsv(headers, rows) {
  const escape = (value) => {
    const text = value === undefined || value === null ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.map(escape).join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\n");
}

// Deterministic and seed-stable: the same participant always lands in the same
// split for a given seed, so a split can be reproduced without shipping it.
export function assignSplit(key, seed, testFraction) {
  if (typeof testFraction !== "number" || !Number.isFinite(testFraction) || testFraction < 0 || testFraction > 1) {
    throw new Error("Split testFraction must be a finite number between 0 and 1.");
  }
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

export function prepare(rawRows, config, rawHeaders) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Dataset config must be an object.");
  for (const name of ["split", "slices"]) {
    if (config[name] !== undefined && (!config[name] || typeof config[name] !== "object" || Array.isArray(config[name]))) {
      throw new Error(`Dataset ${name} config must be an object.`);
    }
  }
  const columns = config.columns ?? {};
  const labelMap = config.labelMap ?? {};
  const slices = config.slices ?? {};
  const split = { by: "participant", testFraction: 0.3, seed: "occulert", ...(config.split ?? {}) };
  if (split.by !== "participant") throw new Error("Only participant-level splitting is supported.");
  if (typeof split.testFraction !== "number" || !Number.isFinite(split.testFraction) || split.testFraction <= 0 || split.testFraction >= 1) {
    throw new Error("Dataset split testFraction must be greater than 0 and less than 1.");
  }
  if (typeof split.seed !== "string" || !split.seed.trim()) throw new Error("Split seed must be a non-empty string.");
  const sliceNames = new Set();
  for (const [name, sourceColumn] of Object.entries(slices)) {
    const normalized = name.trim().toLowerCase();
    if (!normalized || normalized !== name || CANONICAL_COLUMNS.has(normalized) || sliceNames.has(normalized)) {
      throw new Error(`Slice name "${name}" must be unique, lowercase, and must not replace a canonical column.`);
    }
    if (typeof sourceColumn !== "string" || !sourceColumn.trim()) throw new Error(`Slice "${name}" needs a source column.`);
    // An existing column may legitimately contain blank measurements. An
    // absent mapped column instead indicates a broken export/configuration.
    const hasSourceColumn = rawHeaders
      ? rawHeaders.includes(sourceColumn)
      : rawRows.some(row => Object.hasOwn(row, sourceColumn));
    if (!hasSourceColumn) throw new Error(`Slice "${name}" source column "${sourceColumn}" is absent from the raw input CSV.`);
    sliceNames.add(normalized);
  }

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

    const earValue = raw[columns.ear ?? "ear"];
    if (!validEar(earValue)) {
      note("invalid or missing EAR");
      continue;
    }
    const ear = Number(earValue);

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
      Object.defineProperty(row, sliceName, { value: raw[sourceColumn] ?? "", enumerable: true, configurable: true, writable: true });
    }
    kept.push(row);
  }

  const participants = new Map();
  const leakedParticipants = new Set();
  for (const row of kept) {
    if (participants.has(row.participant) && participants.get(row.participant) !== row.split) leakedParticipants.add(row.participant);
    participants.set(row.participant, row.split);
  }
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
      participantsInBothSplits: [...leakedParticipants],
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

  const configBytes = await readFile(configPath);
  const inputBytes = await readFile(input);
  const config = JSON.parse(configBytes.toString("utf8"));
  const { headers: rawHeaders, rows: rawRows } = parseDelimited(inputBytes.toString("utf8"));
  const { headers, rows, manifest } = prepare(rawRows, config, rawHeaders);
  manifest.provenance = {
    ...sourceSnapshot(),
    inputSha256: contentSha256(inputBytes),
    configurationSha256: contentSha256(configBytes),
  };

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
