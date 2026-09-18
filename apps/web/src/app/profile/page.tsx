'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useApi, useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import type { MeResponse } from '@/lib/types';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, SectionHeading, Skeleton } from '@/components/ui';

/**
 * Profile, reminders and settings.
 *
 * The default location is a genuine convenience: most people report problems in
 * the same neighbourhood repeatedly, and pre-filling it removes a step from
 * every future report.
 */

export default function ProfilePage() {
  const { session, loading: sessionLoading, signOut } = useAuth();
  const api = useApi();
  const router = useRouter();

  const [me, setMe] = useState<MeResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [locality, setLocality] = useState('');
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/signin?next=/profile');
  }, [router, session, sessionLoading]);

  const load = useCallback(async () => {
    try {
      const result = await api<MeResponse>('/me');
      setMe(result);
      setDisplayName(result.profile.displayName ?? '');
      setLocality(result.profile.defaultLocation?.locality ?? '');
      setCity(result.profile.defaultLocation?.city ?? '');
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not load your profile.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (session) void load();
  }, [load, session]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(undefined);
    try {
      await api('/me', {
        method: 'PATCH',
        body: {
          displayName: displayName.trim() || undefined,
          defaultLocation: locality.trim() || city.trim() ? { locality: locality.trim(), city: city.trim() } : undefined,
        },
      });
      await load();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not save that.');
    } finally {
      setSaving(false);
    }
  }, [api, city, displayName, load, locality]);

  const markRead = useCallback(
    async (notificationId: string) => {
      try {
        await api(`/me/notifications/${notificationId}/read`, { method: 'POST', body: {} });
        await load();
      } catch {
        // Marking a reminder read is not worth an error dialogue.
      }
    },
    [api, load],
  );

  if (sessionLoading || loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!session || !me) return null;

  const unread = me.notifications.filter((item) => !item.read);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Profile &amp; reminders</h1>

      {error ? (
        <Alert tone="bad" title="Something went wrong">
          {error}
        </Alert>
      ) : null}

      {session.kind === 'guest' ? (
        <Alert tone="warn" title="You are in a demo session">
          <p>
            This session and its sample cases disappear on their own. Create an account if you want to track a real
            problem.
          </p>
          <Link href="/signin">
            <Button size="sm" className="mt-3">
              Create an account
            </Button>
          </Link>
        </Alert>
      ) : null}

      <Card className="p-5 sm:p-6">
        <SectionHeading
          title="Reminders"
          description="CivicSOS checks your open cases every day and tells you when to chase one."
          aside={unread.length > 0 ? <Badge tone="accent">{unread.length} unread</Badge> : undefined}
        />
        <div className="mt-5">
          {me.notifications.length === 0 ? (
            <EmptyState
              icon="🔔"
              title="No reminders yet"
              description="When one of your cases passes its follow-up date, a reminder appears here."
            />
          ) : (
            <ul className="space-y-3">
              {me.notifications.map((item) => (
                <li
                  key={item.notificationId}
                  className={`rounded-xl border p-4 ${item.read ? 'border-line bg-surface' : 'border-accent-line bg-accent-soft'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{item.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-muted">{item.body}</p>
                      <p className="mt-1.5 text-xs text-ink-faint">{formatDateTime(item.createdAt)}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Link href={`/cases/${item.caseId}`}>
                        <Button size="sm" variant="ghost">
                          Open case
                        </Button>
                      </Link>
                      {!item.read ? (
                        <Button size="sm" variant="ghost" onClick={() => markRead(item.notificationId)}>
                          Mark read
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="Your details" description="Used to pre-fill future reports. Nothing here is shared." />
        <div className="mt-5 space-y-4">
          <Field label="Name for complaints" htmlFor="display-name" hint="Appears in the complaint letters we draft.">
            <Input
              id="display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
              maxLength={120}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Usual area" htmlFor="default-locality">
              <Input
                id="default-locality"
                value={locality}
                onChange={(event) => setLocality(event.target.value)}
                maxLength={160}
              />
            </Field>
            <Field label="City" htmlFor="default-city">
              <Input id="default-city" value={city} onChange={(event) => setCity(event.target.value)} maxLength={80} />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Button loading={saving} onClick={save}>
              {saved ? '✓ Saved' : 'Save'}
            </Button>
            <span role="status" aria-live="polite" className="text-xs text-ink-muted">
              {saved ? 'Your details were saved.' : ''}
            </span>
          </div>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="Account" />
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Signed in as</dt>
            <dd className="font-medium text-ink">{me.profile.email ?? session.displayName ?? 'Demo visitor'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Role</dt>
            <dd className="font-medium text-ink">{me.role}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Session type</dt>
            <dd className="font-medium text-ink">{session.kind === 'guest' ? 'Demo' : 'Account'}</dd>
          </div>
        </dl>
        <Button variant="secondary" className="mt-5" onClick={signOut}>
          Sign out
        </Button>
      </Card>
    </div>
  );
}
