"use client";

import type { CsvMapping } from "@/lib/csv";
import { TagPicker } from "../TagPicker";
import { EventPicker } from "../EventPicker";

/** `tags` and `events` are arrays, not single-column strings, so they get their own controls. */
export type SingleColumnKey = Exclude<keyof CsvMapping, "tags" | "events">;

/**
 * Field order is the order Juliet would recognise them in: who the person is,
 * who they're invited with, how to reach them, where to post the invitation,
 * and finally what they eat. The old grid was ordered by the type definition.
 */
export const MAPPING_FIELDS: Array<{ key: SingleColumnKey; label: string; group: string }> = [
  { key: "firstName", label: "First name", group: "The guest" },
  { key: "lastName", label: "Last name", group: "The guest" },
  { key: "ageType", label: "Adult / child / baby", group: "The guest" },
  { key: "relationship", label: "Relationship", group: "The guest" },
  { key: "locale", label: "Language", group: "The guest" },

  { key: "household", label: "Household / party", group: "The invitation" },
  { key: "envelope", label: "Envelope name", group: "The invitation" },
  { key: "isPlusOne", label: "Marks a plus-one", group: "The invitation" },
  { key: "maxPartySize", label: "Seats on the invitation", group: "The invitation" },
  { key: "plusOneSlots", label: "Extra plus-one seats", group: "The invitation" },

  { key: "email", label: "Email", group: "Getting in touch" },
  { key: "phone", label: "Phone", group: "Getting in touch" },

  { key: "address", label: "Mailing address (all one cell)", group: "Where to post it" },
  { key: "street", label: "Street", group: "Where to post it" },
  { key: "city", label: "City", group: "Where to post it" },
  { key: "state", label: "State", group: "Where to post it" },
  { key: "zip", label: "Zip", group: "Where to post it" },
  { key: "country", label: "Country", group: "Where to post it" },

  { key: "meal", label: "Meal choice", group: "At the table" },
  { key: "dietary", label: "Dietary restrictions", group: "At the table" },
  { key: "notes", label: "Notes", group: "At the table" },
];

const GROUPS = ["The guest", "The invitation", "Getting in touch", "Where to post it", "At the table"];

/**
 * The old wizard, demoted. Everything here used to be the first and only
 * thing the screen showed; now it is a correction surface that opens on
 * request. Deliberately no required-field asterisks: an asterisk stated an
 * internal constraint as if it were an instruction to the user. When a name
 * column really is missing, the wizard says so in words, in `reason`.
 */
export function ColumnMatches({
  open,
  onToggle,
  headers,
  mapping,
  events,
  reason,
  disabled,
  onRemap,
  onTagsChange,
  onEventsChange,
}: {
  open: boolean;
  onToggle: () => void;
  headers: string[];
  mapping: CsvMapping;
  events: Array<{ id: string; name: string }>;
  reason?: string | null;
  disabled?: boolean;
  onRemap: (key: SingleColumnKey, value: string) => void;
  onTagsChange: (next: Array<{ column: string; prefix?: string }>) => void;
  onEventsChange: (next: Array<{ column: string; eventId: string }>) => void;
}) {
  const matched = MAPPING_FIELDS.filter((f) => !!mapping[f.key]);
  const unmatched = MAPPING_FIELDS.filter((f) => !mapping[f.key]);

  return (
    <section className="mt-6 border-t border-hairline pt-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#6b7167] underline decoration-[#c9cdbf] underline-offset-4 transition-colors hover:text-rose hover:decoration-rose motion-reduce:transition-none"
      >
        {open ? "Hide column matches" : "Columns look wrong?"}
      </button>

      {reason && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-blush-border bg-blush px-3.5 py-2.5 text-[13px] leading-relaxed text-rose-deep"
        >
          {reason}
        </p>
      )}

      {/* One `fieldset` rather than a `disabled` prop per control: while an
          import is in flight every mapping input must be inert, or a change
          lands mid-sequence, trips the staleness guard, and silently aborts
          the import with no explanation on screen. */}
      {open && (
        <fieldset disabled={disabled} className="mt-4 disabled:opacity-60">
          <p className="max-w-[70ch] text-[13px] leading-relaxed text-[#4a5147]">
            We matched{" "}
            <span className="font-semibold text-olive-deep">
              {matched.length} of your columns
            </span>{" "}
            automatically:
          </p>
          <p className="mt-1.5 max-w-[78ch] text-[12.5px] leading-relaxed text-[#6b7167]">
            {matched.map((f, i) => (
              <span key={f.key}>
                {i > 0 && <span className="text-[#c9cdbf]"> · </span>}
                <span className="font-medium text-ink">{mapping[f.key] as string}</span>
                <span className="text-[#9aa38f]"> &rarr; </span>
                {f.label.toLowerCase()}
              </span>
            ))}
            {matched.length === 0 && "Nothing matched automatically — set the columns below."}
          </p>
          {unmatched.length > 0 && (
            <p className="mt-2 max-w-[78ch] text-[12.5px] leading-relaxed text-muted">
              Nothing was matched to {listOf(unmatched.map((f) => f.label.toLowerCase()))}. That
              is usually because your spreadsheet doesn&rsquo;t have those columns, which is
              fine.
            </p>
          )}

          <p className="mt-5 text-[12.5px] text-[#6b7167]">
            Change any match below. Everything updates as you go.
          </p>

          <div className="mt-3 flex flex-col gap-5">
            {GROUPS.map((group) => (
              <div key={group}>
                <p className="text-[11px] font-semibold tracking-[0.08em] text-[#6b7167] uppercase">
                  {group}
                </p>
                <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(178px,1fr))] gap-2">
                  {MAPPING_FIELDS.filter((f) => f.group === group).map((f) => (
                    <label key={f.key} className="flex flex-col gap-1 text-[12px] text-[#4a5147]">
                      {f.label}
                      <select
                        value={(mapping[f.key] as string) ?? ""}
                        onChange={(e) => onRemap(f.key, e.target.value)}
                        className="rounded-lg border border-[#dddbd0] bg-white px-2 py-2 text-[12.5px] text-ink transition-colors hover:border-[#c9cdbf] focus:border-rose focus:outline-none disabled:opacity-50"
                      >
                        <option value="">&mdash; not in my sheet &mdash;</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-1">
            <TagPicker headers={headers} value={mapping.tags ?? []} onChange={onTagsChange} />
            {events.length > 0 && (
              <EventPicker
                headers={headers}
                events={events}
                value={mapping.events ?? []}
                onChange={onEventsChange}
              />
            )}
          </div>
        </fieldset>
      )}
    </section>
  );
}

function listOf(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}
