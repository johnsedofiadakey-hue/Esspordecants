// Spreadsheets run text that starts with = + - or @ as a formula. Names and addresses
// come from customers, so any cell like that is defused with a leading apostrophe.
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // A plain phone number such as "+233 24 123 4567" is safe and should stay readable.
  if (/^[=+\-@\t\r]/.test(text) && !/^\+[0-9 ()-]+$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const toCsv = (rows: unknown[][]) => `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
