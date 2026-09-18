'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useApi, useAuth } from '@/lib/auth';
import type { MeResponse } from '@/lib/types';
import { Alert, Button, ButtonLink, Card, Field, Input, PageHeader, SectionHeading, Skeleton } from '@/components/ui';
import { IconShield, IconSignOut } from '@/components/icons';

/**
 * Settings.
 *
 * Deliberately short. The only things a citizen genuinely needs to control are
 * the details that pre-fill their complaints and the ability to end the session;
 * everything else would be settings for the sake of having settings.
 */
export default function SettingsPage() {
  const { session, loading: sessionLoading, signOut } = useAuth();
  const api = useApi();
  const router = useRouter();

  const [me, setMe] = useState<MeResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [locality, setLocality] = useState('');
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/signin?next=/settings');
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
      setError(caught instanceof Error ? caught.message : 'We could not load your settings.');
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
          defaultLocation:
            locality.trim() || city.trim() ? { locality: locality.trim(), city: city.trim() } : undefined,
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

  if (sessionLoading || (loading && session)) {
    return (
      <div className="mx-auto max-w-2xl space-y-6" aria-busy="true">
        <PageHeader title="Settings" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (!session || !me) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Settings" description="Details used to pre-fill your complaints. Nothing here is shared." />

      {error ? (
        <Alert tone="bad" title="Something went wrong">
          {error}
        </Alert>
      ) : null}

      <Card className="p-5 sm:p-6">
        <SectionHeading title="Your details" description="These go into the complaint letters we draft for you." />
        <div className="mt-5 space-y-4">
          <Field label="Name for complaints" htmlFor="display-name" hint="As you want it to appear on official letters.">
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
              {saved ? 'Saved' : 'Save changes'}
            </Button>
            <span role="status" aria-live="polite" className="text-xs text-ink-muted">
              {saved ? 'Your details were saved.' : ''}
            </span>
          </div>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="Account" />
        <dl className="mt-4 space-y-2.5 text-sm">
          {[
            ['Signed in as', me.profile.email ?? session.displayName ?? 'Demo visitor'],
            ['Role', me.role],
            ['Session type', session.kind === 'guest' ? 'Demo session' : 'Account'],
            ['Civic Points', `${me.profile.civicPoints.toLocaleString()} · ${me.level.level.label}`],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-line pb-2.5 last:border-0 last:pb-0">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-right font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <Button variant="secondary" className="mt-5" onClick={signOut} icon={<IconSignOut className="h-4 w-4" />}>
          Sign out
        </Button>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="Privacy" description="What CivicSOS does with what you tell it." />
        <ul className="mt-4 space-y-3 text-sm leading-relaxed text-ink-muted">
          <li className="flex gap-3">
            <IconShield className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
            Phone numbers, emails and ID numbers are stripped from your text before any AI sees it.
          </li>
          <li className="flex gap-3">
            <IconShield className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
            Your cases are private to you. Access is checked on the server on every request.
          </li>
          <li className="flex gap-3">
            <IconShield className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
            Shared locations are rounded to roughly a kilometre — we never keep your exact position.
          </li>
        </ul>
        <ButtonLink href="/about" variant="ghost" size="sm" className="mt-4 -ml-3">
          Read more about how CivicSOS works
        </ButtonLink>
      </Card>
    </div>
  );
}
