import Link from "next/link";
export default function NotFound() { return <div className="p-6"><h1 className="text-xl font-semibold">Household not found</h1><Link className="mt-3 inline-block underline" href="/admin/guests">Back to guests</Link></div>; }
