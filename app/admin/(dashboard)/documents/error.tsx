"use client";

export default function DocumentsError({ reset }: { reset: () => void }) {
  return <div className="rounded-xl border border-hairline bg-paper p-8 text-center">
    <h2 className="text-xl font-semibold">We couldn’t load your documents</h2>
    <p className="mt-3 text-sm text-muted">Please try again in a moment.</p>
    <button onClick={reset} className="mt-5 min-h-11 rounded-lg bg-olive-deep px-4 py-2 text-sm text-cream">Try again</button>
  </div>;
}
