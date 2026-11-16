import Papa from "papaparse";

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (result.errors.length) {
    const messages = result.errors.slice(0, 8).map((error) =>
      `${typeof error.row === "number" ? `Row ${error.row + 2}: ` : ""}${error.message}`,
    );
    throw new Error(`The CSV has a formatting problem. ${messages.join(" · ")} Check quotes and the number of columns, then upload again.`);
  }
  return { headers: result.meta.fields ?? [], rows: result.data };
}
