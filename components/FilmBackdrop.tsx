/**
 * Wedding film backdrop, softly washed so content stays readable.
 * Position it inside a `relative … watercolor-bg overflow-hidden` container
 * and render page content in a `relative z-10` layer above it.
 * Shared by the guest surface, the admin login, and the admin dashboard.
 */
export function FilmBackdrop() {
  return (
    <>
      <video
        className="pointer-events-none fixed inset-0 h-full w-full object-cover opacity-25 motion-reduce:hidden"
        autoPlay
        muted
        loop
        playsInline
        poster="/video/hero-v5-poster.jpg"
        aria-hidden
      >
        <source src="/video/hero-v5.mp4" type="video/mp4" />
      </video>
      {/* Static poster fallback when motion is reduced */}
      <div
        className="pointer-events-none fixed inset-0 hidden bg-cover bg-center opacity-25 motion-reduce:block"
        style={{ backgroundImage: "url(/video/hero-v5-poster.jpg)" }}
        aria-hidden
      />
    </>
  );
}
