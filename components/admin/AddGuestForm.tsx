import { GuestMutationForm } from "./GuestMutationForm";
import { addGuestForm } from "@/app/admin/(dashboard)/guests/actions";

export function AddGuestForm(props: { householdId: string }) {
  const action = addGuestForm.bind(null, props.householdId);
  const inputClass =
    "rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13px] outline-none focus:border-olive";
  return (
    <GuestMutationForm
      action={action}
      className="flex items-center gap-2 rounded-xl border border-dashed border-[#d8d5c8] px-4.5 p-4 max-md:flex-wrap"
    >
      <input type="hidden" name="operation_id" value={crypto.randomUUID()} />
      <input
        aria-label="First name"
        name="first_name"
        required
        placeholder="First name"
        className={`w-32 ${inputClass} max-md:w-full`}
      />
      <input
        aria-label="Last name"
        name="last_name"
        placeholder="Last name"
        className={`w-32 ${inputClass} max-md:w-full`}
      />
      <select
        aria-label="Age group"
        name="age_type"
        defaultValue="adult"
        className={inputClass}
      >
        <option value="adult">Adult</option>
        <option value="child">Child</option>
        <option value="infant">Infant</option>
      </select>
      <input
        aria-label="Relationship"
        name="relationship"
        placeholder="Relationship (optional)"
        className={`min-w-0 flex-1 ${inputClass}`}
      />
      <button className="rounded-lg bg-olive-deep px-4 py-2 text-[12.5px] font-semibold whitespace-nowrap text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose active:scale-[0.97] motion-reduce:transition-none">
        Add guest
      </button>
    </GuestMutationForm>
  );
}
