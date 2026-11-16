"use client";
import { suggestSeating } from "@/lib/domain/seating-suggestions";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignHousehold, createTable, editTable, unassignGuest, type ActionResult } from "@/app/admin/(dashboard)/seating/actions";
import type { SeatAssignmentRow, SeatingTableRow } from "@/lib/types";

type Household = { id: string; displayName: string; guests: Array<{ id: string; name: string }> };
export function SeatingTools({ eventId, tables, assignments, households, attendingIds, canEdit = true }: { eventId: string; tables: SeatingTableRow[]; assignments: SeatAssignmentRow[]; households: Household[]; attendingIds: string[]; canEdit?: boolean }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();
  const yes = new Set(attendingIds);
  const guests = new Map(households.flatMap(h => h.guests.map(g => [g.id, g] as const)));
  const stale = assignments.filter(a => !yes.has(a.guest_id));
  const suggestions = suggestSeating(households,tables,assignments,attendingIds);
  const overflow = tables.filter(t => assignments.filter(a => a.table_id === t.id).length > t.capacity);
  function run(work: () => Promise<ActionResult>) {
    if (pending) return;
    start(async () => {
      try { const result = await work(); setMessage(result.ok ? "Saved." : result.message ?? "This change could not be saved."); }
      catch { setMessage("The connection dropped. Refreshing to check the saved chart before you retry."); }
      router.refresh();
    });
  }
  return <section className="rounded-xl border border-hairline bg-white/70 p-4">
    <h2 className="text-[14.5px] font-semibold text-ink">Seating check</h2>
    {stale.length === 0 && overflow.length === 0
      ? <p className="mt-1 text-[13px] text-muted">Everything is in order: no table is over its size, and everyone seated is still coming.</p>
      : <p className="mt-1 text-[13px] font-medium text-rose-deep">{[stale.length ? `${stale.length} ${stale.length === 1 ? "seat is" : "seats are"} held by someone who is no longer coming` : "", overflow.length ? `${overflow.length} ${overflow.length === 1 ? "table has" : "tables have"} more guests than seats (${overflow.map(t => t.name).join(", ")})` : ""].filter(Boolean).join(" · ")}.</p>}
    {message && <p role="status" className="my-2 text-sm text-rose-deep">{message}</p>}
    {stale.map(a => <div key={a.guest_id} className="mt-2 flex flex-wrap items-center gap-3 text-sm"><span>{guests.get(a.guest_id)?.name ?? "A guest who was removed"} is no longer coming · {tables.find(t => t.id === a.table_id)?.name}</span>{canEdit && <button disabled={pending} onClick={() => run(() => unassignGuest(a.guest_id, eventId))} className="underline text-rose-deep">Free this seat</button>}</div>)}
    {canEdit && suggestions.length>0 && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">{suggestions.length} {suggestions.length === 1 ? "suggestion" : "suggestions"} for where to seat families</summary><p className="my-2 text-sm text-muted">Nobody who already has a seat is moved. Each suggestion keeps one household together at a table with room.</p>{suggestions.map(s=><div key={s.householdId} className="my-2 flex flex-wrap items-center gap-3 text-sm"><span>{s.householdName} ({s.guestIds.length}) → {s.tableName}</span><button disabled={pending} onClick={()=>run(()=>assignHousehold(s.guestIds,eventId,s.tableId))} className="rounded-lg border border-[#dddbd0] bg-white px-3 py-1.5 font-medium hover:border-olive">Seat them there</button></div>)}</details>}
    <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Seat guests from a list (no dragging)</summary>
      <div className="mt-3 flex flex-col gap-3">{households.map(h => {
        const attendees = h.guests.filter(g => yes.has(g.id));
        if (!attendees.length) return null;
        return <div key={h.id} className="rounded-lg border border-hairline p-3"><p className="text-sm font-semibold">{h.displayName}</p>
          {canEdit && <form className="my-2 flex flex-wrap gap-2" action={form => { const target = String(form.get("table")); if (target) run(() => assignHousehold(attendees.map(g => g.id), eventId, target)); }}>
            <select name="table" required aria-label={`Table for all of ${h.displayName}`} className="rounded-lg border border-[#dddbd0] bg-white p-2 text-sm"><option value="">Choose a table for everyone</option>{tables.map(t => <option key={t.id} value={t.id}>{t.name} · {t.capacity} seats</option>)}</select><button disabled={pending} className="rounded-lg bg-olive-deep px-3 text-sm font-medium text-cream">Seat together</button>
          </form>}
          {attendees.map(g => { const seat = assignments.find(a => a.guest_id === g.id); return <div key={g.id} className="mt-2 flex flex-wrap items-center gap-2 text-sm"><span className="min-w-32">{g.name}</span><select disabled={pending || !canEdit} aria-label={`Table for ${g.name}`} value={seat?.table_id ?? ""} onChange={e => { const target=e.target.value; run(() => target ? assignHousehold([g.id], eventId, target) : unassignGuest(g.id, eventId)); }} className="rounded-lg border border-[#dddbd0] bg-white p-2"><option value="">No table yet</option>{tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>; })}
        </div>;
      })}</div>
    </details>
    {canEdit && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Rename, resize or add tables</summary><div className="mt-3 space-y-3">
      {tables.map(t => <form key={`${t.id}:${t.name}:${t.capacity}:${t.shape}`} className="flex flex-wrap gap-2" action={form => run(() => editTable(t.id,eventId,String(form.get("name")),Number(form.get("capacity")),String(form.get("shape")) as "round"|"rect"|"banquet"))}>
        <input name="name" aria-label={`Name for ${t.name}`} defaultValue={t.name} required className="min-w-0 rounded-lg border border-[#dddbd0] bg-white p-2 text-sm" maxLength={120}/>
        <input name="capacity" aria-label={`Seats at ${t.name}`} title="Seats" type="number" min={1} max={1000} defaultValue={t.capacity} required className="w-20 rounded-lg border border-[#dddbd0] bg-white p-2 text-sm"/>
        <select name="shape" aria-label={`Shape for ${t.name}`} defaultValue={t.shape} className="rounded-lg border border-[#dddbd0] bg-white p-2 text-sm"><option value="round">Round</option><option value="rect">Long</option><option value="banquet">Head table</option></select><button disabled={pending} className="rounded-lg border border-[#dddbd0] bg-white px-3 text-sm font-medium hover:border-olive">Save</button>
      </form>)}
      <form className="flex flex-wrap gap-2" action={form => run(() => createTable(eventId,String(form.get("name")),Number(form.get("capacity"))))}><input name="name" aria-label="New table name" placeholder="New table name" required maxLength={120} className="rounded-lg border border-[#dddbd0] bg-white p-2 text-sm"/><input name="capacity" type="number" aria-label="New table capacity" min={1} max={1000} defaultValue={8} required className="w-20 rounded-lg border border-[#dddbd0] bg-white p-2 text-sm"/><button disabled={pending} className="rounded-lg bg-olive-deep px-3 text-sm font-medium text-cream">Add table</button></form>
    </div></details>}
  </section>;
}
