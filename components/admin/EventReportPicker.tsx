export function EventReportPicker({ events, eventId }: { events: Array<{ id: string; name: string }>; eventId?: string }) {
  return <form className="no-print flex flex-wrap items-end gap-3" method="get">
    <label className="text-sm text-ink">Event
      <select name="event" defaultValue={eventId ?? ""} required className="ml-2 rounded-lg border border-hairline bg-white p-2">
        <option value="" disabled>Choose an event</option>
        {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
    </label>
    <button className="rounded-lg bg-olive-deep px-4 py-2 text-sm text-white">Show event</button>
  </form>;
}
