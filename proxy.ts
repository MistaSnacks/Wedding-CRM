import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-app-path", request.nextUrl.pathname);
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  if (
    request.nextUrl.pathname.startsWith("/admin") ||
    request.nextUrl.pathname.startsWith("/api/export")
  ) {
    const client = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (cookies) => {
            for (const { name, value } of cookies)
              request.cookies.set(name, value);
            requestHeaders.set("cookie", request.cookies.toString());
            response = NextResponse.next({
              request: { headers: requestHeaders },
            });
            for (const { name, value, options } of cookies)
              response.cookies.set(name, value, options);
          },
        },
      },
    );
    await client.auth.getUser();
  }
  return response;
}
export const config = {
  matcher: ["/admin/:path*", "/api/export/:path*", "/rsvp/:path*"],
};
