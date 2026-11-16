"use client";
import { GuestMutationForm } from "./GuestMutationForm";
import {
  saveGuestForm,
  transferGuests,
} from "@/app/admin/(dashboard)/guests/actions";
import type { GuestRow } from "@/lib/types";
const cls =
  "mt-1 w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm";
export function GuestEditor({ guest }: { guest: GuestRow }) {
  const action = saveGuestForm.bind(null, guest.id);
  return (
    <details className="w-full border-t border-hairline pt-2">
      <summary className="cursor-pointer text-sm font-semibold">
        Edit guest details
      </summary>
      <GuestMutationForm
        action={action}
        className="mt-3 grid gap-3 sm:grid-cols-2"
      >
        {(
          [
            ["first_name", "First name"],
            ["last_name", "Last name"],
            ["relationship", "Relationship"],
            ["dietary_restrictions", "Dietary restrictions"],
            ["allergies", "Allergies"],
            ["accessibility_needs", "Accessibility needs"],
            ["internal_notes", "Internal notes (private)"],
          ] as const
        ).map(([key, label]) => (
          <label className="text-sm" key={key}>
            {label}
            <input
              name={key}
              className={cls}
              required={key === "first_name" || key === "last_name"}
              defaultValue={guest[key] ?? ""}
            />
          </label>
        ))}
        <label className="text-sm">
          Age group
          <select name="age_type" className={cls} defaultValue={guest.age_type}>
            <option value="adult">Adult</option>
            <option value="child">Child</option>
            <option value="infant">Infant</option>
          </select>
        </label>
        <label className="text-sm">
          <input name="is_vip" type="checkbox" defaultChecked={guest.is_vip} />{" "}
          VIP
        </label>
        <button className="rounded-lg bg-olive-deep p-3 text-sm text-cream">
          Save guest
        </button>
      </GuestMutationForm>
    </details>
  );
}
export function HouseholdTransfer({
  sourceId,
  guests,
  targets,
  operationId,
}: {
  sourceId: string;
  guests: GuestRow[];
  targets: Array<{ id: string; display_name: string }>;
  operationId: string;
}) {
  const action = transferGuests.bind(null, sourceId);
  return (
    <details className="rounded-xl border border-hairline p-4">
      <summary className="cursor-pointer text-sm font-semibold">
        Move guests · merge or split a household
      </summary>
      <GuestMutationForm action={action} className="mt-3 space-y-3">
        <input type="hidden" name="operation_id" value={operationId} />
        <p className="text-sm">
          Select individual guests to move or split. Select everyone to merge.
          Their RSVP, meal and seating records are retained. The destination
          receives this household’s event invitations. Existing destination
          guests may gain unanswered event invitations. Household-level answers
          and historical activity stay with the original household. An empty
          source is archived and can be restored.
        </p>
        <fieldset>
          <legend className="text-sm font-semibold">Guests to move</legend>
          {guests.map((g) => (
            <label className="block text-sm" key={g.id}>
              <input type="checkbox" name="guest_ids" value={g.id} />{" "}
              {g.first_name} {g.last_name}
            </label>
          ))}
        </fieldset>
        <label className="block text-sm">
          Destination
          <select name="target" className={cls}>
            <option value="">Create a new household (split)</option>
            {targets
              .filter((t) => t.id !== sourceId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name}
                </option>
              ))}
          </select>
        </label>
        <label className="block text-sm">
          New household name (for a split)
          <input name="new_name" className={cls} />
        </label>
        <label className="block text-sm">
          <input type="checkbox" name="reviewed" required /> I reviewed the
          selected guests, destination and invitation changes.
        </label>
        <button className="rounded-lg bg-olive-deep px-4 py-2 text-sm text-cream">
          Move selected guests
        </button>
      </GuestMutationForm>
    </details>
  );
}
