import Link from "next/link";

export default function VendorNotFound() {
  return <div className="mx-auto max-w-lg rounded-xl border border-hairline bg-paper p-8 text-center">
    <h1 className="text-xl font-semibold">We couldn’t find that vendor</h1>
    <p className="mt-3 text-sm text-muted">The link may be out of date, or the vendor may have been removed. Your other vendors are still in your list.</p>
    <Link href="/admin/vendors" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-olive-deep px-4 py-2 text-sm text-cream">Back to vendors</Link>
  </div>;
}
