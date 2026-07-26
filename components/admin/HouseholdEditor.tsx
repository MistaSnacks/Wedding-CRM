import { updateHousehold, deleteHousehold } from "@/app/admin/(dashboard)/guests/actions";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { formatMailingAddress, provenanceLabel } from "@/lib/domain/mailing-address";
import type { MailingAddress } from "@/lib/csv/types";

export function HouseholdEditor(props: {
  householdId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  maxPartySize: number;
  plusOneSlots: number;
  internalNotes: string | null;
  mailingAddress: MailingAddress | null;
}) {
  const action = updateHousehold.bind(null, props.householdId);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl bg-paper p-4.5 p-4">
      <p className="text-[11.5px] font-semibold tracking-[0.09em] text-[#6b7167]">HOUSEHOLD SETTINGS & NOTES</p>
      <div className="flex gap-2">
        <input name="display_name" defaultValue={props.displayName} className="flex-1 rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13px] outline-none focus:border-olive" />
        <input name="email" defaultValue={props.email ?? ""} placeholder="Email" className="w-56 rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13px] outline-none focus:border-olive" />
        <input name="phone" defaultValue={props.phone ?? ""} placeholder="Phone" className="w-36 rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13px] outline-none focus:border-olive" />
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-[12.5px] text-[#4a5147]">
          Max party
          <input name="max_party_size" type="number" min={1} defaultValue={props.maxPartySize} className="w-14 rounded-lg border border-[#dddbd0] bg-white px-2 py-1.5 text-center text-[13px]" />
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-[#4a5147]">
          Plus-one slots
          <input name="plus_one_slots" type="number" min={0} defaultValue={props.plusOneSlots} className="w-14 rounded-lg border border-[#dddbd0] bg-white px-2 py-1.5 text-center text-[13px]" />
        </label>
      </div>
      <div className="flex flex-col gap-1">
        <textarea
          name="mailing_address"
          rows={3}
          defaultValue={formatMailingAddress(props.mailingAddress)}
          placeholder="Mailing address"
          className="rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-olive"
        />
        <input type="hidden" name="mailing_address_prev" value={formatMailingAddress(props.mailingAddress)} />
        {provenanceLabel(props.mailingAddress) && (
          <p className="text-[11.5px] text-muted">Address {provenanceLabel(props.mailingAddress)}</p>
        )}
      </div>
      <textarea
        name="internal_notes"
        rows={3}
        defaultValue={props.internalNotes ?? ""}
        placeholder="Internal notes (never shown to guests)"
        className="rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-olive"
      />
      <div className="flex items-center justify-between">
        <ConfirmButton
          label="Delete household"
          confirmLabel="Delete household and all guests?"
          variant="danger"
          action={deleteHousehold.bind(null, props.householdId)}
        />
        <button className="rounded-lg bg-olive-deep px-4 py-2 text-[12.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] motion-reduce:transition-none">
          Save changes
        </button>
      </div>
    </form>
  );
}
