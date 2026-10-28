/** Small RFC 4180 CSV parser for master imports (no formulas are evaluated). */

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 1_000_000;

export class CsvError extends Error {
  constructor(
    readonly code: "CSV_TOO_LARGE" | "CSV_MALFORMED" | "CSV_EMPTY",
    message: string,
  ) {
    super(message);
  }
}

export function parseCsv(text: string): string[][] {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw new CsvError("CSV_TOO_LARGE", "The file is larger than 1 MB");
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      if (field.length > 0) throw new CsvError("CSV_MALFORMED", `Unexpected quote on line ${rows.length + 1}`);
      quoted = true;
      i++;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\r" || c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += c === "\r" && src[i + 1] === "\n" ? 2 : 1;
      if (rows.length > MAX_IMPORT_ROWS + 1) throw new CsvError("CSV_TOO_LARGE", `The file has more than ${MAX_IMPORT_ROWS} rows`);
    } else {
      field += c;
      i++;
    }
  }
  if (quoted) throw new CsvError("CSV_MALFORMED", "A quoted value is not closed");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (nonEmpty.length < 2) throw new CsvError("CSV_EMPTY", "The file needs a header row and at least one data row");
  if (nonEmpty.length > MAX_IMPORT_ROWS + 1) throw new CsvError("CSV_TOO_LARGE", `The file has more than ${MAX_IMPORT_ROWS} rows`);
  return nonEmpty;
}

/** Values that spreadsheet programs would run as formulas when the file is exported again. */
export function looksLikeFormula(value: string): boolean {
  return /^[=+\-@\t\r]/.test(value);
}

/** Make a value safe to place in an exported CSV cell. */
export function csvCell(value: string): string {
  const safe = looksLikeFormula(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
