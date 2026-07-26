"use client";

/**
 * Phone seating: arranging the room stays on desktop; here you can see each
 * table and seat (or unseat) people. Opened by tapping a table card.
 */
export type SheetGuest = { id: string; name: string; ageType: string };
export type SheetHousehold = { id: string; displayName: string; guests: SheetGuest[] };

export function MobileAssignSheet(props: {
  tableLabel: string;
  capacity: number;
  seated: SheetGuest[];
  unassigned: SheetHousehold[];
  onAssign: (guestIds: string[]) => void;
  onUnassign: (guestId: string) => void;
  onClose: () => void;
}) {
  const seatsLeft = props.capacity - props.seated.length;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label={`Seat people at ${props.tableLabel}`}>
      <button type="button" aria-label="Close" onClick={props.onClose} className="absolute inset-0 bg-black/30" />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col gap-4 overflow-y-auto rounded-t-2xl bg-paper px-5 pb-8 pt-4 shadow-[0_-12px_40px_rgba(0,0,0,0.25)]">
        <div className="mx-auto h-1 w-10 rounded-full bg-[#d8d5c8]" />
        <div>
          <h2 className="text-[17px] font-semibold text-ink">{props.tableLabel}</h2>
          <p className="text-[12.5px] text-muted">
            {props.seated.length} of {props.capacity} seats taken
          </p>
        </div>

        {props.seated.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11.5px] font-semibold tracking-[0.09em] text-[#6b7167]">SEATED HERE</p>
            {props.seated.map((g) => (
              <div key={g.id} className="flex items-center gap-2 rounded-lg bg-white px-3.5 py-2.5">
                <span className="flex-1 text-[13.5px] text-ink">{g.name}</span>
                <button
                  type="button"
                  onClick={() => props.onUnassign(g.id)}
                  className="text-[12.5px] font-medium text-rose"
                >
                  Unseat
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-[11.5px] font-semibold tracking-[0.09em] text-[#6b7167]">STILL NEEDS A SEAT</p>
          {props.unassigned.map((h) => (
            <div key={h.id} className="flex flex-col gap-1 rounded-lg bg-white px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[13.5px] font-semibold text-ink">{h.displayName}</span>
                <button
                  type="button"
                  disabled={h.guests.length > seatsLeft}
                  onClick={() => props.onAssign(h.guests.map((g) => g.id))}
                  className="rounded-full bg-olive-deep px-3 py-1 text-[12px] font-semibold text-cream disabled:opacity-40"
                >
                  Seat all {h.guests.length > 1 ? h.guests.length : ""}
                </button>
              </div>
              {h.guests.length > 1 &&
                h.guests.map((g) => (
                  <div key={g.id} className="flex items-center gap-2 pl-2">
                    <span className="flex-1 text-[12.5px] text-[#4a5147]">{g.name}</span>
                    <button
                      type="button"
                      disabled={seatsLeft < 1}
                      onClick={() => props.onAssign([g.id])}
                      className="text-[12px] font-medium text-olive-deep disabled:opacity-40"
                    >
                      Seat
                    </button>
                  </div>
                ))}
            </div>
          ))}
          {!props.unassigned.length && (
            <p className="text-[13px] text-muted">Everyone attending has a seat.</p>
          )}
        </div>
      </div>
    </div>
  );
}
