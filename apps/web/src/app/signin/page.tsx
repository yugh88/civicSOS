'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Alert, Button, Card, Field, Input, SectionHeading, Skeleton } from '@/components/ui';

/**
 * Sign in, sign up, and the one-click demo.
 *
 * The demo path is first and largest on purpose: a judge, or anyone evaluating
 * the product, should be able to see the whole journey without creating an
 * account. A demo session gets its own private copy of the sample cases and
 * expires by itself.
 */

type Mode = 'signin' | 'signup' | 'confirm';

function SignInContent() {
  const { signIn, signUp, confirmSignUp, resendCode, startDemo, session, accountsEnabled } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'none' | 'demo' | 'form' | 'resend'>('none');
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  /**
   * Where to go once a session exists.
   *
   * Only one place performs the redirect (the effect below), so a deep-linked
   * demo start cannot race its own navigation against the session watcher.
   */
  const next = params.get('next') ?? (params.get('demo') === '1' ? '/cases' : '/');

  // Once a session exists, this page has nothing left to offer.
  useEffect(() => {
    if (session) router.replace(next);
  }, [session, router, next]);

  const beginDemo = useCallback(async () => {
    setBusy('demo');
    setError(undefined);
    try {
      await startDemo();
      // Navigation is handled by the session effect above.
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not start the demo.');
    } finally {
      setBusy('none');
    }
  }, [startDemo]);

  // Deep link from elsewhere in the app: /signin?demo=1 starts it immediately.
  useEffect(() => {
    if (params.get('demo') === '1' && !session && busy === 'none') void beginDemo();
    // Intentionally only on first render with the flag present.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy('form');
      setError(undefined);
      setNotice(undefined);
      try {
        if (mode === 'signin') {
          await signIn(email.trim(), password);
          router.replace(next);
        } else if (mode === 'signup') {
          const result = await signUp(email.trim(), password);
          if (result.needsConfirmation) {
            setMode('confirm');
            setNotice(`We emailed a confirmation code to ${email.trim()}. Enter it below.`);
          } else {
            await signIn(email.trim(), password);
            router.replace(next);
          }
        } else {
          await confirmSignUp(email.trim(), code.trim());
          await signIn(email.trim(), password);
          router.replace(next);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'That did not work. Please try again.');
      } finally {
        setBusy('none');
      }
    },
    [code, confirmSignUp, email, mode, next, password, router, signIn, signUp],
  );

  const resend = useCallback(async () => {
    setBusy('resend');
    setError(undefined);
    try {
      await resendCode(email.trim());
      setNotice('We sent a new code.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not send a new code.');
    } finally {
      setBusy('none');
    }
  }, [email, resendCode]);

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Continue with CivicSOS</h1>
        <p className="text-sm text-ink-muted">
          Your cases are private to you, so CivicSOS needs a session before it can track one.
        </p>
      </div>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="Just looking around?" description="See the whole thing with sample cases. No signup." />
        <Button full size="lg" className="mt-4" loading={busy === 'demo'} onClick={beginDemo}>
          Try the demo
        </Button>
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          You get your own private copy of four sample cases — including one that is overdue, so you can see the
          reminder and escalation behaviour. Everything is clearly labelled as demo data and the session expires on
          its own.
        </p>
      </Card>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <Card className="p-5 sm:p-6">
        {!accountsEnabled ? (
          <Alert tone="warn" title="Accounts are not configured on this deployment">
            Real sign-up needs a Cognito user pool. Use the demo above to see the full product, or see DEPLOYMENT.md
            to configure accounts.
          </Alert>
        ) : (
          <form onSubmit={submit} className="space-y-5" noValidate>
            <SectionHeading
              title={mode === 'signup' ? 'Create an account' : mode === 'confirm' ? 'Confirm your email' : 'Sign in'}
              description={
                mode === 'signup'
                  ? 'So your cases are still here next week.'
                  : mode === 'confirm'
                    ? 'Check your inbox for the six-digit code.'
                    : undefined
              }
            />

            {notice ? <Alert tone="accent">{notice}</Alert> : null}
            {error ? (
              <Alert tone="bad" title="We could not do that">
                {error}
              </Alert>
            ) : null}

            <Field label="Email" htmlFor="email" required>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={mode === 'confirm'}
              />
            </Field>

            {mode !== 'confirm' ? (
              <Field
                label="Password"
                htmlFor="password"
                required
                hint={mode === 'signup' ? 'At least 12 characters, with upper case, lower case and a number.' : undefined}
              >
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={mode === 'signup' ? 12 : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
            ) : (
              <Field label="Confirmation code" htmlFor="code" required>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  maxLength={10}
                />
              </Field>
            )}

            <Button type="submit" full size="lg" loading={busy === 'form'}>
              {mode === 'signup' ? 'Create account' : mode === 'confirm' ? 'Confirm and sign in' : 'Sign in'}
            </Button>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              {mode === 'confirm' ? (
                <Button type="button" variant="ghost" size="sm" loading={busy === 'resend'} onClick={resend}>
                  Send a new code
                </Button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMode(mode === 'signin' ? 'signup' : 'signin');
                    setError(undefined);
                    setNotice(undefined);
                  }}
                  className="font-medium text-accent underline underline-offset-2"
                >
                  {mode === 'signin' ? 'Create an account instead' : 'I already have an account'}
                </button>
              )}
            </div>
          </form>
        )}
      </Card>

      <p className="text-center text-xs text-ink-muted">
        <Link href="/about" className="font-medium text-accent underline underline-offset-2">
          How CivicSOS handles your information
        </Link>
      </p>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-80 w-full max-w-md" />}>
      <SignInContent />
    </Suspense>
  );
}
