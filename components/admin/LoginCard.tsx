import { sendMagicLink } from "@/app/admin/login/actions";

const ERRORS: Record<string, string> = {
  invalid: "That doesn't look like an email address.",
  rate_limited: "Too many attempts — wait a few minutes.",
  send_failed: "Couldn't send the link. Try again.",
  no_access: "This account doesn't have access to any wedding yet.",
};

export function LoginCard({ error, sent }: { error?: string; sent?: boolean }) {
  return (
    <div className="mt-10 w-full max-w-[360px] rounded-2xl border border-[#e7e3d2] bg-white p-7 shadow-[0_18px_40px_rgba(59,72,35,0.14)]">
      <h2 className="font-display text-2xl font-semibold text-olive-deep">Sign in</h2>
      {sent ? (
        <p className="mt-3 text-sm leading-relaxed text-olive">
          Check your inbox — we sent you a sign-in link.
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-sm text-[#5c6151]">We&apos;ll email you a magic link.</p>
          <form action={sendMagicLink} className="mt-4 flex flex-col gap-3">
            <input
              name="email"
              type="email"
              required
              placeholder="you@example.com"
              className="w-full rounded-xl border border-[#ddd9c4] bg-cream px-4 py-3.5 text-sm outline-none focus:border-olive"
            />
            {error && <p className="text-sm text-rose">{ERRORS[error] ?? "Something went wrong."}</p>}
            <button
              type="submit"
              className="w-full rounded-xl bg-olive-deep py-3.5 text-[15px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] motion-reduce:transition-none"
            >
              Send magic link
            </button>
          </form>
        </>
      )}
    </div>
  );
}
