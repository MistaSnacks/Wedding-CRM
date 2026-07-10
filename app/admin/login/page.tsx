import { LoginCard } from "@/components/admin/LoginCard";
import { FilmBackdrop } from "@/components/FilmBackdrop";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="watercolor-bg relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6">
      <FilmBackdrop />

      <div className="relative z-10 flex flex-col items-center">
        <p className="text-[11px] font-medium tracking-[0.28em] text-rose">GUEST CRM</p>
        <h1 className="font-display mt-2 text-4xl font-medium text-olive-deep">Juliet &amp; Juan</h1>
        <LoginCard error={params.error} sent={params.sent === "1"} />
      </div>
    </div>
  );
}
