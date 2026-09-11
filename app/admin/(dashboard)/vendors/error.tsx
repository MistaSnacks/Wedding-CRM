"use client";

import Link from "next/link";

export default function VendorError({ reset }: { reset: () => void }) {
  return <div className="mx-auto max-w-lg rounded-xl border border-hairline bg-paper p-8 text-center">
    <h2 className="text-xl font-semibold">We couldn’t load your vendors</h2>
    <p className="mt-3 text-sm text-muted">Please try again in a moment.</p>
    <div className="mt-5 flex flex-wrap justify-center gap-3"><button onClick={reset} className="min-h-11 rounded-lg bg-olive-deep px-4 py-2 text-sm text-cream">Try again</button><Link href="/admin" className="flex min-h-11 items-center px-3 text-sm text-olive underline">Back to overview</Link></div>
  </div>;
}
