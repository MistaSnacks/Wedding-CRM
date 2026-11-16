"use client";
import { GuestMutationForm } from "./GuestMutationForm";
import {
  saveHouseholdForm,
  deleteHousehold,
} from "@/app/admin/(dashboard)/guests/actions";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import {
  formatMailingAddress,
  provenanceLabel,
} from "@/lib/domain/mailing-address";
import type { MailingAddress } from "@/lib/csv/types";

const labelCls = "flex flex-col gap-1 text-[12.5px] font-medium text-ink";
const fieldCls =
  "rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13.5px] font-normal text-ink outline-none transition-colors focus:border-olive";

export function HouseholdEditor(props: {
  householdId: string;
  displayName: string;
  primaryContactName: string | null;
  preferredLocale: string;
  tags: string[];
  email: string | null;
  phone: string | null;
  maxPartySize: number;
  plusOneSlots: number;
  internalNotes: string | null;
  mailingAddress: MailingAddress | null;
}) {
  const action = saveHouseholdForm.bind(null, props.householdId);
  return (
    <GuestMutationForm
      action={action}
      className="flex flex-col gap-4 rounded-2xl border border-hairline bg-white/75 p-5 max-md:p-4"
    >
      <div>
        <h2 className="text-[14.5px] font-semibold text-ink">Contact details & invitation</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">Press “Save changes” at the bottom when you are done.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className={labelCls}>
          Name on the invitation
          <input name="display_name" defaultValue={props.displayName} className={fieldCls} />
        </label>
        <label className={labelCls}>
          Main contact person
          <input name="primary_contact_name" defaultValue={props.primaryContactName ?? ""} className={fieldCls} />
        </label>
        <label className={labelCls}>
          Email
          <input name="email" type="email" defaultValue={props.email ?? ""} placeholder="No email yet" className={fieldCls} />
        </label>
        <label className={labelCls}>
          Phone
          <input name="phone" type="tel" defaultValue={props.phone ?? ""} placeholder="No phone yet" className={fieldCls} />
        </label>
        <label className={labelCls}>
          Language for their emails and RSVP page
          <select name="preferred_locale" defaultValue={props.preferredLocale} className={`${fieldCls} admin-field`}>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="vi">Tiếng Việt</option>
          </select>
        </label>
        <label className={labelCls}>
          Groups
          <input name="tags" defaultValue={props.tags.join(", ")} placeholder="For example: family, college friends" className={fieldCls} />
          <span className="font-normal text-muted">Separate with commas. Use groups to filter the guest list and reports.</span>
        </label>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-3 rounded-xl bg-paper p-3.5">
        <label className={`${labelCls} max-w-[15rem]`}>
          Most people they may bring in total
          <input
            name="max_party_size"
            type="number"
            min={1}
            defaultValue={props.maxPartySize}
            className={`${fieldCls} w-20 text-center`}
          />
        </label>
        <label className={`${labelCls} max-w-[15rem]`}>
          Plus-ones they may add by name
          <input
            name="plus_one_slots"
            type="number"
            min={0}
            defaultValue={props.plusOneSlots}
            className={`${fieldCls} w-20 text-center`}
          />
        </label>
      </div>
      <label className={labelCls}>
        Mailing address
        <textarea
          name="mailing_address"
          rows={3}
          defaultValue={formatMailingAddress(props.mailingAddress)}
          placeholder="No address yet"
          className={`${fieldCls} leading-relaxed`}
        />
        <input type="hidden" name="mailing_address_prev" value={formatMailingAddress(props.mailingAddress)} />
        {provenanceLabel(props.mailingAddress) && (
          <span className="text-[11.5px] font-normal text-muted">Address {provenanceLabel(props.mailingAddress)}</span>
        )}
      </label>
      <label className={labelCls}>
        Private notes
        <textarea
          name="internal_notes"
          rows={3}
          defaultValue={props.internalNotes ?? ""}
          placeholder="Only your planning team sees this. Guests never do."
          className={`${fieldCls} leading-relaxed`}
        />
      </label>
      <div className="flex items-center justify-between">
        <ConfirmButton
          label="Remove from the guest list"
          confirmLabel="Remove? You can bring them back from Archived."
          variant="danger"
          action={deleteHousehold.bind(null, props.householdId)}
        />
        <button className="rounded-lg bg-olive-deep px-4 py-2 text-[12.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] motion-reduce:transition-none">
          Save changes
        </button>
      </div>
    </GuestMutationForm>
  );
}
