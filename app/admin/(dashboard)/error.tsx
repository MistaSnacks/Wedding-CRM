"use client";
import Link from "next/link";
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section role="alert" className="rounded-xl border border-blush-border bg-blush p-6">
    <h1 className="text-xl font-semibold text-ink">This page couldn't be loaded.</h1>
    <p className="my-3 text-sm text-rose-deep">Your saved information is still there. Try loading the page again.</p>
    <button onClick={reset} className="mr-4 rounded-lg bg-olive-deep px-4 py-2 text-white">Try again</button>
    <Link href="/admin" className="text-sm underline">Back to overview</Link>
  </section>;
}
