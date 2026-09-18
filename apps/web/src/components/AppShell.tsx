'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi, useAuth } from '@/lib/auth';
import { APP_NAME } from '@/lib/config';
import { formatRelative } from '@/lib/format';
import { onProfileChanged } from '@/lib/profile-events';
import type { MeResponse } from '@/lib/types';
import { Avatar, Badge, ButtonLink, Dot } from './ui';
import {
  IconBell,
  IconCases,
  IconClose,
  IconHome,
  IconMenu,
  IconReport,
  IconRewards,
  IconSettings,
  IconSignOut,
  IconUser,
} from './icons';

/**
 * Application shell: header, navigation, notifications and the profile menu.
 *
 * Navigation is persistent and identical across every screen, because a civic
 * tool that moves its own furniture is a civic tool people give up on. On mobile
 * the same items collapse into a sheet rather than being hidden or reordered.
 *
 * The demo banner is always on screen during a demo session — nobody should be
 * able to mistake seeded data for their own.
 */

const NAV = [
  { href: '/', label: 'Home', icon: IconHome },
  { href: '/report', label: 'Report', icon: IconReport },
  { href: '/cases', label: 'My Cases', icon: IconCases },
  { href: '/rewards', label: 'Rewards', icon: IconRewards },
] as const;

const PROFILE_MENU = [
  { href: '/profile', label: 'My Profile', icon: IconUser },
  { href: '/cases', label: 'My Cases', icon: IconCases },
  { href: '/rewards', label: 'Rewards', icon: IconRewards },
  { href: '/notifications', label: 'Notifications', icon: IconBell },
  { href: '/settings', label: 'Settings', icon: IconSettings },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading, signOut } = useAuth();
  const pathname = usePathname();
  const api = useApi();

  const [me, setMe] = useState<MeResponse | undefined>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const bellRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  /**
   * Loads the profile summary that feeds the unread badge, the points chip and
   * the avatar. A failure here is invisible by design: a missing badge must
   * never break the page the person actually came for.
   */
  const refresh = useCallback(async () => {
    if (!session) {
      setMe(undefined);
      return;
    }
    try {
      setMe(await api<MeResponse>('/me'));
    } catch {
      setMe(undefined);
    }
  }, [api, session]);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  // Points and unread counts also change without a navigation — a redemption,
  // a resolved case, a notification marked read. Listen for those too.
  useEffect(() => onProfileChanged(() => void refresh()), [refresh]);

  // Close everything on navigation so no panel lingers over new content.
  useEffect(() => {
    setMenuOpen(false);
    setBellOpen(false);
    setProfileOpen(false);
  }, [pathname]);

  // Dismiss the dropdowns on an outside click or Escape — standard menu
  // behaviour that people expect without being told.
  useEffect(() => {
    if (!bellOpen && !profileOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (bellOpen && bellRef.current && !bellRef.current.contains(target)) setBellOpen(false);
      if (profileOpen && profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setBellOpen(false);
        setProfileOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [bellOpen, profileOpen]);

  const markAllRead = useCallback(async () => {
    try {
      await api('/me/notifications/read-all', { method: 'POST', body: {} });
      await refresh();
    } catch {
      // Not worth interrupting anyone over.
    }
  }, [api, refresh]);

  const unread = me?.unreadCount ?? 0;
  const displayName = me?.profile.displayName || session?.displayName || me?.profile.email || 'You';
  const points = me?.profile.civicPoints ?? 0;

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <a
        href="#main"
        className="sr-only-focusable absolute left-4 top-4 z-50 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          {/* Mobile menu trigger sits first so the logo stays centred-ish. */}
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((open) => !open)}
            className="-ml-2 rounded-xl p-2 text-ink-soft transition-colors hover:bg-surface-sunken md:hidden"
          >
            <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
            {menuOpen ? <IconClose className="h-5 w-5" /> : <IconMenu className="h-5 w-5" />}
          </button>

          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-ink">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-[13px] font-bold text-white shadow-card"
            >
              CS
            </span>
            <span className="text-[17px]">{APP_NAME}</span>
          </Link>

          <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                    active ? 'bg-accent-soft text-accent-ink' : 'text-ink-soft hover:bg-surface-sunken hover:text-ink'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            {loading ? (
              <div className="h-10 w-28 skeleton rounded-xl" />
            ) : session ? (
              <>
                {/* Points are shown quietly — a status line, not a scoreboard. */}
                <Link
                  href="/rewards"
                  className="hidden items-center gap-1.5 rounded-full bg-gold-soft px-3 py-1.5 text-xs font-semibold text-gold ring-1 ring-inset ring-gold-line transition-colors hover:bg-gold-line/40 sm:inline-flex"
                >
                  {points.toLocaleString()}
                  <span className="font-normal">pts</span>
                </Link>

                <div ref={bellRef} className="relative">
                  <button
                    type="button"
                    aria-expanded={bellOpen}
                    aria-haspopup="menu"
                    onClick={() => {
                      setBellOpen((open) => !open);
                      setProfileOpen(false);
                    }}
                    className="relative rounded-xl p-2.5 text-ink-soft transition-colors hover:bg-surface-sunken"
                  >
                    <span className="sr-only">
                      Notifications{unread > 0 ? `, ${unread} unread` : ''}
                    </span>
                    <IconBell className="h-5 w-5" />
                    {unread > 0 ? (
                      <span className="absolute right-2 top-2 flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface" />
                      </span>
                    ) : null}
                  </button>

                  {bellOpen ? (
                    <NotificationDropdown
                      notifications={me?.notifications ?? []}
                      unread={unread}
                      onMarkAllRead={markAllRead}
                    />
                  ) : null}
                </div>

                <div ref={profileRef} className="relative">
                  <button
                    type="button"
                    aria-expanded={profileOpen}
                    aria-haspopup="menu"
                    onClick={() => {
                      setProfileOpen((open) => !open);
                      setBellOpen(false);
                    }}
                    className="flex items-center gap-2 rounded-full p-0.5 transition-opacity hover:opacity-85"
                  >
                    <span className="sr-only">Account menu for {displayName}</span>
                    <Avatar name={displayName} size="md" />
                  </button>

                  {profileOpen ? (
                    <div
                      role="menu"
                      className="rise absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-line bg-surface shadow-lift"
                    >
                      <div className="border-b border-line bg-surface-soft px-4 py-3">
                        <p className="truncate text-sm font-semibold text-ink">{displayName}</p>
                        <p className="truncate text-xs text-ink-muted">
                          {me?.profile.email ?? (session.kind === 'guest' ? 'Demo session' : 'Signed in')}
                        </p>
                        <p className="mt-1.5 text-xs font-medium text-gold">
                          {points.toLocaleString()} Civic Points
                          {me?.level ? ` · ${me.level.level.label}` : ''}
                        </p>
                      </div>
                      <ul className="py-1.5">
                        {PROFILE_MENU.map((item) => (
                          <li key={item.label}>
                            <Link
                              href={item.href}
                              role="menuitem"
                              className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink"
                            >
                              <item.icon className="h-[18px] w-[18px] text-ink-faint" />
                              {item.label}
                              {item.href === '/notifications' && unread > 0 ? (
                                <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">
                                  {unread}
                                </span>
                              ) : null}
                            </Link>
                          </li>
                        ))}
                      </ul>
                      <div className="border-t border-line py-1.5">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={signOut}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink"
                        >
                          <IconSignOut className="h-[18px] w-[18px] text-ink-faint" />
                          Sign out
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <ButtonLink href="/signin" size="sm">
                Sign in
              </ButtonLink>
            )}
          </div>
        </div>

        {/* Mobile navigation sheet. Same items, same order, larger targets. */}
        {menuOpen ? (
          <nav id="mobile-nav" aria-label="Main" className="rise border-t border-line bg-surface px-3 py-2 md:hidden">
            <ul className="space-y-0.5">
              {NAV.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium ${
                        active ? 'bg-accent-soft text-accent-ink' : 'text-ink-soft'
                      }`}
                    >
                      <item.icon className="h-5 w-5" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
              {session ? (
                <>
                  <li className="my-1.5 border-t border-line" />
                  {PROFILE_MENU.filter((item) => !NAV.some((nav) => nav.href === item.href)).map((item) => (
                    <li key={item.label}>
                      <Link
                        href={item.href}
                        className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-ink-soft"
                      >
                        <item.icon className="h-5 w-5" />
                        {item.label}
                        {item.href === '/notifications' && unread > 0 ? (
                          <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">
                            {unread}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      onClick={signOut}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-ink-soft"
                    >
                      <IconSignOut className="h-5 w-5" />
                      Sign out
                    </button>
                  </li>
                </>
              ) : null}
            </ul>
          </nav>
        ) : null}
      </header>

      {session?.kind === 'guest' ? (
        <div className="border-b border-gold-line bg-gold-soft px-4 py-2.5 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
            <Badge tone="warn" icon={<Dot tone="warn" />}>
              Demo session
            </Badge>
            <span>
              You are signed in as a demo visitor with your own sample cases. Nothing here is a real complaint, and this
              session expires on its own.
            </span>
          </div>
        </div>
      ) : null}

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>

      <Footer />
    </div>
  );
}

function NotificationDropdown({
  notifications,
  unread,
  onMarkAllRead,
}: {
  notifications: MeResponse['notifications'];
  unread: number;
  onMarkAllRead: () => void;
}) {
  return (
    <div
      role="menu"
      aria-label="Notifications"
      className="rise absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-lift"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-soft px-4 py-3">
        <p className="text-sm font-semibold text-ink">Notifications</p>
        {unread > 0 ? (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-xs font-medium text-accent transition-colors hover:text-accent-hover"
          >
            Mark all read
          </button>
        ) : null}
      </div>

      {notifications.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-ink-muted">Nothing yet. Reminders will appear here.</p>
      ) : (
        <ul className="max-h-80 divide-y divide-line overflow-y-auto">
          {notifications.slice(0, 6).map((item) => (
            <li key={item.notificationId}>
              <Link
                href={`/cases/${item.caseId}`}
                role="menuitem"
                className={`flex gap-3 px-4 py-3 transition-colors hover:bg-surface-soft ${item.read ? '' : 'bg-accent-soft/40'}`}
              >
                <span className="mt-1.5">
                  <Dot tone={notificationTone(item.kind)} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
                  <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-ink-muted">{item.body}</span>
                  <span className="mt-1 block text-[11px] text-ink-faint">{formatRelative(item.createdAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-line p-2">
        <Link
          href="/notifications"
          className="block rounded-xl px-3 py-2 text-center text-sm font-medium text-accent transition-colors hover:bg-accent-soft"
        >
          See all notifications
        </Link>
      </div>
    </div>
  );
}

export function notificationTone(kind: string) {
  switch (kind) {
    case 'POINTS_EARNED':
      return 'gold' as const;
    case 'ESCALATION_AVAILABLE':
      return 'bad' as const;
    case 'FOLLOW_UP_DUE':
      return 'warn' as const;
    case 'REWARD_AVAILABLE':
      return 'teal' as const;
    default:
      return 'accent' as const;
  }
}

function Footer() {
  return (
    <footer className="border-t border-line bg-surface-soft">
      <div className="mx-auto max-w-6xl px-4 py-9 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent text-[10px] font-bold text-white"
              >
                CS
              </span>
              {APP_NAME}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-ink-muted">
              CivicSOS is an independent tool. It is not affiliated with, endorsed by, or operated by any government
              body, and it does not submit complaints on your behalf — you always submit through the official channel
              yourself. Always confirm department and contact details on your own city or state official website.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-col gap-2 text-xs">
            <Link href="/about" className="font-medium text-accent transition-colors hover:text-accent-hover">
              How CivicSOS works
            </Link>
            <Link href="/report" className="text-ink-muted transition-colors hover:text-ink">
              Report a problem
            </Link>
            <Link href="/rewards" className="text-ink-muted transition-colors hover:text-ink">
              Rewards
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
