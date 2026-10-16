// A small CSV reader for the files people export from Excel or Google Sheets: quoted cells, doubled
// quotes, commas and line breaks inside quotes, CRLF or LF, and the byte-order mark Excel adds.
// Pure: text in, rows out. Each row keeps the line it started on, so problems can point at it.

export type CsvRow = { line: number; cells: string[] };

export class CsvError extends Error {}

export function parseCsv(text: string): CsvRow[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  const endCell = () => {
    cells.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    // Lines with nothing on them (often the last one) aren't rows.
    if (cells.some((value) => value.trim() !== "")) rows.push({ line: rowLine, cells });
    cells = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === "\n") line += 1;
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (char === ",") {
      endCell();
    } else if (char === "\r" && source[i + 1] === "\n") {
      // Handled with the \n.
    } else if (char === "\n" || char === "\r") {
      endRow();
      line += 1;
      rowLine = line;
    } else {
      cell += char;
    }
  }
  if (quoted) throw new CsvError(`A quote opened on line ${rowLine} is never closed.`);
  endRow();
  return rows;
}

/** A cell for a CSV we write. A leading = + - or @ would be a formula in a spreadsheet, so it gets a quote. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
