/** Exhaust a PostgREST collection. Callers must use a stable unique order. */
export async function readAll<T>(
  makeQuery: () => { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }> },
  pageSize = 500,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error("Invalid page size");
  const rows: T[] = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await makeQuery().range(start, start + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

export function requireData<T>(result: { data: T | null; error: { message: string } | null }, operation: string): T {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${operation}: no data returned`);
  return result.data;
}
