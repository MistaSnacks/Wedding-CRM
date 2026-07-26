import { addGuest } from "@/app/admin/(dashboard)/guests/actions";

export function AddGuestForm(props: { householdId: string }) {
  const action = addGuest.bind(null, props.householdId);
  const inputClass =
    "rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13px] outline-none focus:border-olive";
  return (
    <form action={action} className="flex items-center gap-2 rounded-xl border border-dashed border-[#d8d5c8] px-4.5 p-4 max-md:flex-wrap">
      <input name="first_name" required placeholder="First name" className={`w-32 ${inputClass} max-md:w-full`} />
      <input name="last_name" placeholder="Last name" className={`w-32 ${inputClass} max-md:w-full`} />
      <select name="age_type" defaultValue="adult" className={inputClass}>
        <option value="adult">Adult</option>
        <option value="child">Child</option>
        <option value="infant">Infant</option>
      </select>
      <input name="relationship" placeholder="Relationship (optional)" className={`min-w-0 flex-1 ${inputClass}`} />
      <button className="rounded-lg bg-olive-deep px-4 py-2 text-[12.5px] font-semibold whitespace-nowrap text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose active:scale-[0.97] motion-reduce:transition-none">
        Add guest
      </button>
    </form>
  );
}
