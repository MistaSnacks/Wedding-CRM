import { createHousehold } from "@/app/admin/(dashboard)/guests/actions";

export function NewHouseholdForm() {
  return (
    <form
      action={createHousehold}
      className="flex flex-col gap-3 rounded-xl border border-hairline bg-paper p-5"
    >
      <h2 className="text-[14.5px] font-semibold text-ink">New household</h2>
      <div className="flex gap-2">
        <input name="display_name" required placeholder="Display name (e.g. The Smith Family)" className="flex-1 rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-olive" />
        <input name="primary_contact_name" placeholder="Primary contact" className="w-56 rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-olive" />
      </div>
      <div className="flex gap-2">
        <input name="email" type="email" placeholder="Email" className="flex-1 rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-olive" />
        <input name="phone" placeholder="Phone" className="w-44 rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-olive" />
        <select name="preferred_locale" className="w-24 rounded-lg border border-[#dddbd0] bg-white px-2 py-2.5 text-[13.5px]">
          <option value="en">EN</option>
          <option value="es">ES</option>
          <option value="vi">VI</option>
        </select>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-[#4a5147]">
          Max party
          <input name="max_party_size" type="number" min={1} defaultValue={2} className="w-16 rounded-lg border border-[#dddbd0] bg-white px-2 py-2 text-center text-[13.5px]" />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-[#4a5147]">
          Plus-one slots
          <input name="plus_one_slots" type="number" min={0} defaultValue={0} className="w-16 rounded-lg border border-[#dddbd0] bg-white px-2 py-2 text-center text-[13.5px]" />
        </label>
      </div>
      <textarea
        name="guest_names"
        rows={3}
        placeholder={"Guest names, one per line:\nJohn Smith\nSarah Smith"}
        className="rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-olive"
      />
      <div className="flex justify-end gap-2">
        <button className="rounded-lg bg-olive-deep px-5 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] motion-reduce:transition-none">
          Create household
        </button>
      </div>
    </form>
  );
}
