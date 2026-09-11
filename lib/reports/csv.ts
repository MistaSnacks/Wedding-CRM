/** Protect spreadsheet text, including leading whitespace/control characters. */
export function csvCell(value: string | number | undefined): string {
  let text = String(value ?? "");
  if (typeof value !== "number" && /^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function toCsv(rows: Array<Record<string, string | number>>): string {
  if (!rows.length) return "";
  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return [headers.map(csvCell).join(","), ...rows.map(row => headers.map(h => csvCell(row[h])).join(","))].join("\r\n");
}
