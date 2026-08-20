import { beforeAll, describe, expect, it } from "vitest";

// env() validates eagerly on first use; give it the minimum it needs.
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-key-anon-key-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-key-service-key-service";
  process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
  process.env.NEXT_PUBLIC_APP_URL = "https://rsvp.example.com";
});

describe("confirmationHtml", () => {
  it("links to the RSVP only when hotel recommendations were not requested", async () => {
    const { confirmationHtml } = await import("./send");
    const { html } = confirmationHtml({ accessToken: "tok123", locale: "en" });
    expect(html).toContain("https://rsvp.example.com/rsvp/h/tok123");
    expect(html).not.toContain("hotel recommendations");
    expect(html).not.toContain("julietandjuan.com");
  });

  it("adds the hotel line and a second button when the household asked for recommendations", async () => {
    const { confirmationHtml } = await import("./send");
    const { html } = confirmationHtml({
      accessToken: "tok123",
      locale: "en",
      hotelRecsUrl: "https://www.julietandjuan.com/details",
    });
    expect(html).toContain("https://rsvp.example.com/rsvp/h/tok123");
    expect(html).toContain('href="https://www.julietandjuan.com/details"');
    expect(html).toContain("See hotel recommendations");
    expect(html).toContain("hotel recommendations");
  });

  it("localises the hotel copy", async () => {
    const { confirmationHtml } = await import("./send");
    const es = confirmationHtml({ accessToken: "t", locale: "es", hotelRecsUrl: "https://www.julietandjuan.com/details" }).html;
    expect(es).toContain("Ver recomendaciones de hotel");
    const vi = confirmationHtml({ accessToken: "t", locale: "vi", hotelRecsUrl: "https://www.julietandjuan.com/details" }).html;
    expect(vi).toContain("Xem gợi ý khách sạn");
  });
});
