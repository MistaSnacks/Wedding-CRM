"use client";

export function EventPicker({
  headers,
  events,
  value,
  onChange,
}: {
  headers: string[];
  events: Array<{ id: string; name: string }>;
  value: Array<{ column: string; eventId: string }>;
  onChange: (next: Array<{ column: string; eventId: string }>) => void;
}) {
  const set = (eventId: string, column: string) =>
    onChange(
      column
        ? [...value.filter((e) => e.eventId !== eventId), { eventId, column }]
        : value.filter((e) => e.eventId !== eventId),
    );

  return (
    <div className="mt-4">
      <p className="text-[11px] font-semibold tracking-wide text-[#6b7167]">RSVP COLUMN PER EVENT</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {events.map((ev) => (
          <label key={ev.id} className="flex items-center gap-1.5 text-[12.5px]">
            {ev.name}
            <select
              value={value.find((e) => e.eventId === ev.id)?.column ?? ""}
              onChange={(e) => set(ev.id, e.target.value)}
              className="rounded-lg border border-[#dddbd0] bg-white px-2 py-1.5 text-[12.5px]"
            >
              <option value="">—</option>
              {headers.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}
