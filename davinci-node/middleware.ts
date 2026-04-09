import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => req.cookies.get(name)?.value,
        set: (name: string, value: string, options: CookieOptions) => {
          res.cookies.set({ name, value, ...options });
        },
        remove: (name: string, options: CookieOptions) => {
          res.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  // getUser() validates the JWT signature cryptographically.
  // Never use getSession() here — it trusts the cookie contents.
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Forward identity to route handlers.
  const forwarded = new Headers(req.headers);
  forwarded.set('x-user-id', data.user.id);
  forwarded.set('x-user-email', data.user.email ?? '');

  return NextResponse.next({ request: { headers: forwarded } });
}

export const config = {
  // Health is public (used by the homepage status widget).
  matcher: ['/api/chat/:path*', '/api/submit-code/:path*', '/api/admin/:path*'],
};
