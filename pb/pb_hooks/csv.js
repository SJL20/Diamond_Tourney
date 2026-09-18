// Spreadsheet text → rows. Strips the UTF-8 BOM Excel adds, keeps quoted
// commas and apostrophes, and accepts CSV or TSV (Excel paste).

function stripBom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}

function detectDelimiter(headerLine) {
  let tabs = 0;
  let commas = 0;
  let inQuotes = false;
  for (let i = 0; i < headerLine.length; i++) {
    const ch = headerLine[i];
    if (ch === '"') {
      if (inQuotes && headerLine[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === "\t") tabs++;
    if (ch === ",") commas++;
  }
  return tabs > commas ? "\t" : ",";
}

function parseLine(line, delim) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function splitLines(text) {
  const raw = stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    out.push(lines[i]);
  }
  return out;
}

function parseTable(text) {
  const lines = splitLines(text);
  if (!lines.length) return { headers: [], rows: [] };
  const delim = detectDelimiter(lines[0]);
  const headers = parseLine(lines[0], delim).map(function (h) { return String(h || "").trim(); });
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i], delim);
    const row = {};
    let any = false;
    for (let j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      const val = cols[j] != null ? String(cols[j]).trim() : "";
      row[headers[j]] = val;
      if (val) any = true;
    }
    if (any) rows.push(row);
  }
  return { headers: headers.filter(Boolean), rows: rows };
}

function parseCsv(text) {
  const table = parseTable(text);
  return table.rows.map(function (row) {
    const out = {};
    for (let i = 0; i < table.headers.length; i++) {
      const h = table.headers[i];
      out[h.toLowerCase()] = row[h] || "";
    }
    return out;
  });
}

function normalizeHeader(h) {
  return String(h || "").toLowerCase().replace(/[_./]+/g, " ").replace(/[^a-z0-9 +#]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeName(name) {
  return String(name || "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

module.exports = {
  stripBom: stripBom,
  parseTable: parseTable,
  parseCsv: parseCsv,
  normalizeHeader: normalizeHeader,
  normalizeName: normalizeName,
};
