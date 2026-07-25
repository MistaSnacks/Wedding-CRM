"use client";

export function TagPicker({
  headers,
  value,
  onChange,
}: {
  headers: string[];
  value: Array<{ column: string; prefix?: string }>;
  onChange: (next: Array<{ column: string; prefix?: string }>) => void;
}) {
  const toggle = (column: string) =>
    onChange(
      value.some((t) => t.column === column)
        ? value.filter((t) => t.column !== column)
        : [...value, { column }],
    );
  const setPrefix = (column: string, prefix: string) =>
    onChange(value.map((t) => (t.column === column ? { ...t, prefix: prefix || undefined } : t)));

  return (
    <div className="mt-4">
      <p className="text-[11px] font-semibold tracking-wide text-[#6b7167]">TAG COLUMNS</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {headers.map((h) => {
          const picked = value.find((t) => t.column === h);
          return (
            <span key={h} className="flex items-center gap-1.5 rounded-lg border border-[#dddbd0] px-2.5 py-1.5">
              <input type="checkbox" checked={!!picked} onChange={() => toggle(h)} />
              <span className="text-[12.5px]">{h}</span>
              {picked && (
                <input
                  type="text"
                  placeholder="prefix"
                  value={picked.prefix ?? ""}
                  onChange={(e) => setPrefix(h, e.target.value)}
                  className="w-20 rounded border border-[#dddbd0] px-1.5 py-0.5 text-[11.5px]"
                />
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
