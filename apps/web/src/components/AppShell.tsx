'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApi, useAuth } from '@/lib/auth';
import { APP_NAME } from '@/lib/config';
import { Badge, Button } from './ui';
import type { MeResponse } from '@/lib/types';

/**
 * Application shell: header, navigation, session state and the demo banner.
 *
 * The navigation shows only what the signed-in person can actually use, and the
 * demo banner is always visible during a demo session so nobody can mistake
 * seeded data for their own.
 */

const NAV_ITEMS = [
  { href: '/', label: 'Report a problem' },
  { href: '/cases', label: 'My cases' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading, signOut } = useAuth();
  const pathname = usePathname();
  const api = useApi();
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  // Unread reminder count. A failure here is invisible by design: a missing
  // badge must never break the page the person came for.
  useEffect(() => {
    if (!session) {
      setUnread(0);
      return;
    }
    let cancelled = false;
    api<MeResponse>('/me')
      .then((result) => {
        if (!cancelled) setUnread(result.notifications.filter((item) => !item.read).length);
      })
      .catch(() => {
        if (!cancelled) setUnread(0);
      });
    return () => {
      cancelled = true;
    };
  }, [api, session, pathname]);

  // Close the mobile menu on navigation so it never lingers over new content.
  useEffect(() => setMenuOpen(false), [pathname]);

  const navItems = session?.role === 'ADMIN' ? [...NAV_ITEMS, { href: '/admin', label: 'Admin' }] : NAV_ITEMS;

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <a
        href="#main"
        className="sr-only-focusable absolute left-4 top-4 z-50 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-ink">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white"
            >
              CS
            </span>
            <span className="text-[17px]">{APP_NAME}</span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
            {session
              ? navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={pathname === item.href ? 'page' : undefined}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      pathname === item.href
                        ? 'bg-accent-soft text-accent'
                        : 'text-ink-soft hover:bg-surface-soft hover:text-ink'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))
              : null}
          </nav>

          <div className="flex items-center gap-2">
            {loading ? (
              <div className="h-9 w-24 skeleton" />
            ) : session ? (
              <>
                <Link
                  href="/profile"
                  className="relative hidden rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface-soft sm:block"
                >
                  {session.email ?? session.displayName ?? 'Profile'}
                  {unread > 0 ? (
                    <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-white">
                      {unread}
                      <span className="sr-only"> unread reminders</span>
                    </span>
                  ) : null}
                </Link>
                <Button variant="secondary" size="sm" onClick={signOut} className="hidden sm:inline-flex">
                  Sign out
                </Button>
                <button
                  type="button"
                  aria-expanded={menuOpen}
                  aria-controls="mobile-nav"
                  onClick={() => setMenuOpen((open) => !open)}
                  className="rounded-lg p-2 text-ink-soft hover:bg-surface-soft sm:hidden"
                >
                  <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d={menuOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'}
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </>
            ) : (
              <Link href="/signin">
                <Button size="sm">Sign in</Button>
              </Link>
            )}
          </div>
        </div>

        {menuOpen && session ? (
          <nav id="mobile-nav" aria-label="Main" className="border-t border-line bg-surface px-4 py-3 sm:hidden">
            <ul className="space-y-1">
              {[...navItems, { href: '/profile', label: 'Profile & reminders' }].map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={pathname === item.href ? 'page' : undefined}
                    className={`block rounded-lg px-3 py-2.5 text-sm font-medium ${
                      pathname === item.href ? 'bg-accent-soft text-accent' : 'text-ink-soft'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={signOut}
                  className="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink-soft"
                >
                  Sign out
                </button>
              </li>
            </ul>
          </nav>
        ) : null}
      </header>

      {/* Always visible during a demo session — see DemoBadge's rationale. */}
      {session?.kind === 'guest' ? (
        <div className="border-b border-warn-line bg-warn-soft px-4 py-2.5">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
            <Badge tone="warn">Demo session</Badge>
            <span>
              You are signed in as a demo visitor with your own sample cases. Nothing here is a real complaint, and
              this session expires on its own.
            </span>
          </div>
        </div>
      ) : null}

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>

      <footer className="border-t border-line bg-surface-soft">
        <div className="mx-auto max-w-5xl px-4 py-8 text-xs leading-relaxed text-ink-muted sm:px-6">
          <p className="font-semibold text-ink-soft">{APP_NAME}</p>
          <p className="mt-2 max-w-3xl">
            CivicSOS is an independent tool. It is not affiliated with, endorsed by, or operated by any government
            body, and it does not submit complaints on your behalf — you always submit through the official channel
            yourself. Always confirm department and contact details on your own city or state official website.
          </p>
          <p className="mt-3">
            <Link href="/about" className="font-medium text-accent underline underline-offset-2">
              How CivicSOS works
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
