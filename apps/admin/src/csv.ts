// A small spreadsheet reader for the product import. Handles quotes, a leading BOM,
// and comma, semicolon or tab separators (Excel in some regions saves with semicolons).
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

// Header names people are likely to type, mapped to the fields the server expects.
const HEADERS: Record<string, string> = {
  house: "house", brand: "house", name: "name", fragrance: "name", concentration: "concentration", family: "family", scentfamily: "family",
  shortdescription: "shortDescription", summary: "shortDescription", description: "description",
  notestop: "notesTop", topnotes: "notesTop", notesheart: "notesHeart", heartnotes: "notesHeart", notesbase: "notesBase", basenotes: "notesBase",
  sourcebrand: "sourceBrand", sku: "sku", sizeml: "sizeMl", size: "sizeMl", ml: "sizeMl",
  priceghs: "priceGhs", price: "priceGhs", pricecedis: "priceGhs", stock: "stock", quantity: "stock",
};

export function rowsToObjects(table: string[][]): { rows: Record<string, string>[]; unknown: string[] } {
  const [head = [], ...body] = table;
  const keys = head.map((title) => HEADERS[title.toLowerCase().replace(/[^a-z]/g, "")] ?? null);
  const unknown = head.filter((_, index) => keys[index] === null && head[index]!.trim() !== "");
  const rows = body.map((cells) => {
    const entry: Record<string, string> = {};
    keys.forEach((key, index) => {
      if (key) entry[key] = (cells[index] ?? "").trim();
    });
    return entry;
  });
  return { rows, unknown };
}

export const IMPORT_TEMPLATE = [
  "house,name,concentration,family,short_description,description,top_notes,heart_notes,base_notes,source_brand,sku,size_ml,price_ghs,stock",
  'Lattafa,Khamrah,Eau de Parfum,Gourmand,Warm spice and dates.,"A rich, sweet gourmand with cinnamon, dates and vanilla.",Cinnamon; Nutmeg,Dates; Praline,Vanilla; Tonka,Lattafa,LAT-KHA-5,5,85,10',
  "Lattafa,Khamrah,,,,,,,,,LAT-KHA-10,10,150,6",
].join("\r\n");
