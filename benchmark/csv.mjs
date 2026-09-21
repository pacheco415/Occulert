// Shared parser for source exports and the canonical benchmark table.
// Quoted fields may contain commas, doubled quotes, and line breaks.
export function parseTable(input) {
  const text = input.replace(/^\uFEFF/, "");
  const records = [];
  let cells = [], field = "", quoted = false, closed = false, wasQuoted = false;
  const endField = () => { cells.push(wasQuoted ? field : field.trim()); field = ""; closed = false; wasQuoted = false; };
  const endRecord = () => {
    endField();
    if (cells.length > 1 || cells[0] !== "") records.push(cells);
    cells = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === ",") endField();
    else if (char === "\n" || char === "\r") {
      endRecord();
      if (char === "\r" && text[i + 1] === "\n") i += 1;
    } else if (char === '"' && !closed && field.trim() === "") {
      field = ""; quoted = true; wasQuoted = true;
    } else {
      if (char === '"' || (closed && char.trim() !== "")) throw new Error("Malformed CSV quoting");
      if (!closed) field += char;
    }
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  endRecord();
  if (!records.length) return { headers: [], rows: [] };
  const headers = records.shift().map(header => header.trim());
  if (headers.some(header => !header) || new Set(headers.map(header => header.toLowerCase())).size !== headers.length) {
    throw new Error("CSV headers must be non-empty and unique");
  }
  const rows = records.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV column count mismatch on record ${index + 2}`);
    return Object.fromEntries(headers.map((header, position) => [header, values[position]]));
  });
  return { headers, rows };
}

export function validEar(value) {
  return value !== undefined && value !== null && String(value).trim() !== ""
    && Number.isFinite(Number(value)) && Number(value) >= 0;
}
