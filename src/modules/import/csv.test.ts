import { describe, expect, it } from "vitest";
import { CsvError, csvCell, parseCsv } from "./csv";

describe("reading a CSV", () => {
  it("splits cells and rows, keeping the line each row starts on", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 2, cells: ["1", "2"] },
    ]);
  });

  it("reads quoted cells with commas, doubled quotes and line breaks", () => {
    expect(parseCsv('name,note\n"Wangchuk, Karma","said ""hi""\nthen left"\nnext,row')).toEqual([
      { line: 1, cells: ["name", "note"] },
      { line: 2, cells: ["Wangchuk, Karma", 'said "hi"\nthen left'] },
      { line: 4, cells: ["next", "row"] },
    ]);
  });

  it("drops Excel's byte-order mark and blank lines", () => {
    expect(parseCsv("﻿a\n\n,\nb\n")).toEqual([
      { line: 1, cells: ["a"] },
      { line: 4, cells: ["b"] },
    ]);
  });

  it("refuses a quote that never closes", () => {
    expect(() => parseCsv('a\n"b')).toThrow(CsvError);
  });
});

describe("writing a cell", () => {
  it("quotes what needs it and keeps formulas as text", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "x"')).toBe('"say ""x"""');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
  });
});
