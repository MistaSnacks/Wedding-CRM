import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const factory = vi.hoisted(() => vi.fn());
vi.mock("@supabase/ssr", () => ({ createServerClient: factory }));
import { proxy } from "@/proxy";
describe("admin refresh cookie forwarding", () => {
  it("forwards refreshed cookies to both server rendering and the browser", async () => {
    factory.mockImplementation((_url, _key, { cookies }) => ({
      auth: {
        getUser: async () => {
          cookies.setAll([
            {
              name: "sb-session",
              value: "rotated-token",
              options: { httpOnly: true, path: "/" },
            },
          ]);
          return { data: { user: { id: "test" } } };
        },
      },
    }));
    const response = await proxy(
      new NextRequest("https://example.invalid/admin/guests", {
        headers: {
          cookie: "sb-session=old-token",
          "x-app-path": "/rsvp/h/spoof",
        },
      }),
    );
    expect(response.headers.get("set-cookie")).toContain(
      "sb-session=rotated-token",
    );
    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      "sb-session=rotated-token",
    );
    expect(response.headers.get("x-middleware-request-x-app-path")).toBe(
      "/admin/guests",
    );
  });
  it("does not refresh admin auth for guest routes", async () => {
    factory.mockClear();
    await proxy(new NextRequest("https://example.invalid/rsvp/h/token"));
    expect(factory).not.toHaveBeenCalled();
  });
});
