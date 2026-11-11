import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/update-password"];
const MACHINE_API_PREFIXES = ["/api/v1", "/api/webhooks", "/api/cron"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (MACHINE_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    if (pathname === "/login") {
      return NextResponse.next();
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("setup", "missing_env");
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  if (user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const needsMfa = Boolean(
      aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2"
    );

    if (!isPublicPath && needsMfa) {
      const mfaUrl = request.nextUrl.clone();
      mfaUrl.pathname = "/login";
      mfaUrl.searchParams.set("mfa", "required");
      if (pathname !== "/") {
        mfaUrl.searchParams.set("next", pathname);
      }
      return NextResponse.redirect(mfaUrl);
    }

    if (pathname === "/login" && !needsMfa) {
      const homeUrl = request.nextUrl.clone();
      homeUrl.pathname = "/";
      return NextResponse.redirect(homeUrl);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

