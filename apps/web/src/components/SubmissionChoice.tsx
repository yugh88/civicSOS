'use client';

import { useCallback, useState } from 'react';
import { useApi } from '@/lib/auth';
import type { PreparedSubmission } from '@/lib/types';
import { HANDOFF_PARAM, storeHandoff } from '@/lib/practice-handoff';
import { AgentExecution } from './AgentExecution';
import { Alert, Badge, Button, Card, Dot, Field, Input } from './ui';
import { IconArrowRight, IconCheck, IconSend, IconShield, IconSparkle } from './icons';

/**
 * Choosing how the complaint goes out.
 *
 * Two genuinely different things, so they are presented as two choices rather
 * than one button with a caveat:
 *
 *  - **Demo Simulation** always works, reaches nobody, and exists so the whole
 *    workflow can be seen end to end.
 *  - **Official Website** opens the verified channel with the complaint
 *    prepared. CivicSOS stops before Submit; the citizen presses it.
 *
 * The labels never blur: one says "Demo Simulation", the other says "Official
 * Website", and neither borrows the other's language.
 */

/**
 * Which browser assistants to offer the payload to.
 *
 * An unpacked extension gets its ID when it is loaded, so the ID cannot be
 * committed — it is configuration, not code. Nothing secret about it either:
 * an extension ID is public, which is why an environment variable is enough
 * and no secret store is involved.
 */
const EXTENSION_IDS: string[] = (process.env.NEXT_PUBLIC_ASSISTANT_EXTENSION_ID ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter((id) => id.length > 0);

/** The CivicSOS practice portal — our own page, never a government site. */
const PRACTICE_PATH = '/practice-portal';

/**
 * Hands the approved payload to the browser assistant, if it is installed.
 *
 * `target` names the page the payload is for. The assistant refuses a payload
 * delivered anywhere else, so this is the one place the destination is decided.
 */
async function handoffToAssistant(
  prepared: PreparedSubmission,
  target: { origin: string; pathPrefix?: string },
): Promise<boolean> {
  const runtime = (globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime;
  if (!runtime || typeof runtime.sendMessage !== 'function' || EXTENSION_IDS.length === 0) return false;

  const send = runtime.sendMessage as (id: string, message: unknown) => Promise<{ ok?: boolean }>;

  for (const id of EXTENSION_IDS) {
    try {
      const response = await send(id, {
        type: 'CIVICSOS_HANDOFF',
        targetOrigin: target.origin,
        targetPathPrefix: target.pathPrefix,
        payload: prepared.payload,
      });
      if (response?.ok) return true;
    } catch {
      // Not installed, or it declined. The copy-ready view below is the path
      // that always works, so this is never an error the citizen sees.
    }
  }
  return false;
}

function safeOrigin(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function SubmissionChoice({
  caseId,
  onDemo,
  demoBusy,
  disabled,
  onRecorded,
}: {
  caseId: string;
  onDemo: () => void;
  demoBusy: boolean;
  disabled?: boolean;
  /** Called once the citizen records a real reference from the official site. */
  onRecorded?: () => void;
}) {
  const api = useApi();
  const [prepared, setPrepared] = useState<PreparedSubmission | undefined>();
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [assistantActive, setAssistantActive] = useState(false);

  const prepareOfficial = useCallback(async () => {
    setPreparing(true);
    setError(undefined);
    try {
      const result = await api<PreparedSubmission>(`/cases/${caseId}/agent/prepare-official`, {
        method: 'POST',
        // The same approval gate as the demo path — preparing a payload of the
        // citizen's complaint is still acting on their behalf.
        body: { approve: true, provider: 'ASSIST' },
      });
      setPrepared(result);
      const origin = safeOrigin(result.channel.url);
      setAssistantActive(origin ? await handoffToAssistant(result, { origin }) : false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not prepare that.');
    } finally {
      setPreparing(false);
    }
  }, [api, caseId]);

  if (prepared) {
    return (
      <OfficialHandoff
        caseId={caseId}
        prepared={prepared}
        assistantActive={assistantActive}
        onBack={() => setPrepared(undefined)}
        onRecorded={onRecorded}
      />
    );
  }

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight text-ink">Choose submission method</h2>
      <p className="mt-1.5 text-sm text-ink-muted">
        Both start from the complaint you just approved. They end in very different places.
      </p>

      {error ? (
        <Alert tone="bad" className="mt-4" title="We could not prepare that">
          {error}
        </Alert>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col rounded-2xl border border-line p-5 transition-[border-color,box-shadow] duration-200 hover:border-accent-line hover:shadow-card">
          <div className="flex items-center justify-between gap-2">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent"
            >
              <IconSparkle className="h-5 w-5" />
            </span>
            <Badge tone="warn" icon={<Dot tone="warn" />}>
              Demo Simulation
            </Badge>
          </div>

          <h3 className="mt-4 text-[15px] font-semibold text-ink">Run Demo Submission</h3>
          <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-muted">
            See CivicSOS complete the workflow safely, end to end. Nothing reaches any authority and the reference is a{' '}
            <code className="rounded bg-surface-sunken px-1 py-0.5 text-xs">CS-DEMO-</code> placeholder.
          </p>

          <Button
            className="mt-4"
            loading={demoBusy}
            disabled={disabled}
            onClick={onDemo}
            trailingIcon={demoBusy ? undefined : <IconArrowRight className="h-[18px] w-[18px]" />}
          >
            Run Demo Submission
          </Button>
        </div>

        <div className="flex flex-col rounded-2xl border border-line p-5 transition-[border-color,box-shadow] duration-200 hover:border-accent-line hover:shadow-card">
          <div className="flex items-center justify-between gap-2">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-good-soft text-good"
            >
              <IconShield className="h-5 w-5" />
            </span>
            <Badge tone="good" icon={<Dot tone="good" />}>
              Official Website
            </Badge>
          </div>

          <h3 className="mt-4 text-[15px] font-semibold text-ink">Continue on official website</h3>
          <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-muted">
            Open the verified official channel with your complaint prepared. CivicSOS stops before the final Submit —
            you press that yourself.
          </p>

          <Button
            variant="secondary"
            className="mt-4"
            loading={preparing}
            disabled={disabled}
            onClick={prepareOfficial}
            trailingIcon={preparing ? undefined : <IconArrowRight className="h-[18px] w-[18px]" />}
          >
            Continue on official website
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * The hand-off screen.
 *
 * Everything CivicSOS prepared, the limits on what happens next, and a way to
 * copy each field. The copy view is not a fallback for the extension being
 * missing — it is the path that works on every portal, with the assistant as an
 * optional convenience on top.
 */
function OfficialHandoff({
  caseId,
  prepared,
  assistantActive,
  onBack,
  onRecorded,
}: {
  caseId: string;
  prepared: PreparedSubmission;
  assistantActive: boolean;
  onBack: () => void;
  onRecorded?: () => void;
}) {
  const api = useApi();
  const [copied, setCopied] = useState<string | undefined>();
  const [reference, setReference] = useState('');
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [recordError, setRecordError] = useState<string | undefined>();
  const [practiceHandedOff, setPracticeHandedOff] = useState<boolean | undefined>();

  /**
   * Opens the CivicSOS practice portal with the same payload.
   *
   * The assistant's whole value is the things it refuses to do, and a refusal
   * you cannot watch is just a claim. This runs it against a form CivicSOS
   * writes itself, so the sign-in pause, the CAPTCHA pause and the untouched
   * Submit button are all observable — without pointing an untested autofill at
   * a real government site.
   */
  const openPractice = useCallback(async () => {
    /*
     * Two hand-off routes, and the page takes whichever arrives.
     *
     * The extension is offered the payload first, because that is the path a
     * real portal would have to use. But the practice portal is same-origin
     * with this app, so it can also be handed the complaint directly — which
     * means the flow works for anyone who opens CivicSOS, with nothing
     * installed and nothing configured. Without that, "watch the assistant
     * work" would open an empty form for almost every visitor.
     */
    const handed = await handoffToAssistant(prepared, {
      origin: window.location.origin,
      pathPrefix: PRACTICE_PATH,
    });
    setPracticeHandedOff(handed);

    const id = storeHandoff(prepared.payload);
    const target = id ? `${PRACTICE_PATH}?${HANDOFF_PARAM}=${id}` : PRACTICE_PATH;
    window.open(target, '_blank', 'noopener,noreferrer');
  }, [prepared]);

  /**
   * Closes the loop.
   *
   * Everything CivicSOS promises after this point — monitoring, the follow-up,
   * the escalation window — is measured from the filing date and quotes this
   * reference. Telling the citizen to "record it on your case" and then making
   * them go and find the case themselves is where that promise quietly breaks,
   * so the input lives here, next to the site they just used.
   */
  const record = useCallback(async () => {
    setRecording(true);
    setRecordError(undefined);
    try {
      await api(`/cases/${caseId}/submitted`, {
        method: 'POST',
        body: {
          officialReference: reference.trim(),
          channel: prepared.channel.label,
        },
      });
      setRecorded(true);
      onRecorded?.();
    } catch (caught) {
      setRecordError(caught instanceof Error ? caught.message : 'We could not record that.');
    } finally {
      setRecording(false);
    }
  }, [api, caseId, onRecorded, prepared.channel.label, reference]);

  const copy = useCallback(async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(undefined), 2000);
    } catch {
      setCopied(undefined);
    }
  }, []);

  return (
    <div className="space-y-4">
      <AgentExecution
        steps={prepared.steps}
        running={false}
        title="Your complaint is prepared"
        subtitle={`Ready for ${prepared.channel.label}.`}
      />

      <Alert
        tone="good"
        title={`Official channel — ${prepared.authorityName}`}
        icon={<IconShield className="h-[18px] w-[18px]" />}
      >
        <p>
          This is a verified official channel. CivicSOS is handing your complaint to you, not submitting it — the site
          will confirm the submission itself, and only then should you record the reference on your case.
        </p>
      </Alert>

      {/* The limits travel with the data, not just in copy on this screen. */}
      <Card className="p-5">
        <h3 className="text-[15px] font-semibold text-ink">What happens when you continue</h3>
        <ul className="mt-3 space-y-2.5">
          {prepared.boundaries.map((line) => (
            <li key={line} className="flex gap-3 text-sm leading-relaxed text-ink-soft">
              <IconCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-good" />
              {line}
            </li>
          ))}
        </ul>

        {assistantActive ? (
          <p className="mt-4 rounded-xl bg-accent-soft p-3 text-sm text-ink-soft">
            The CivicSOS browser assistant is installed and has your approved complaint. It will fill the supported
            fields once the page loads.
          </p>
        ) : (
          <p className="mt-4 rounded-xl bg-surface-soft p-3 text-sm text-ink-muted">
            Copy each field below as you go. Installing the CivicSOS browser assistant fills the supported ones for
            you, but it is entirely optional.
          </p>
        )}
      </Card>

      {/* A place to watch the assistant work, and refuse, before trusting it. */}
      <Card className="p-5">
        <h3 className="text-[15px] font-semibold text-ink">See what the assistant does first</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          CivicSOS includes a practice grievance portal of its own. Open it and the assistant carries this complaint
          across: it waits at the sign-in step, waits again at the CAPTCHA, fills the supported fields once you have
          cleared both yourself, and leaves Submit alone. It is not a government website and it sends nothing anywhere.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={openPractice} trailingIcon={<IconArrowRight className="h-[18px] w-[18px]" />}>
            Open practice portal
          </Button>
          {practiceHandedOff === false ? (
            <p className="text-xs text-ink-muted">
              Running without the browser extension — the practice portal shares this app&apos;s origin, so the
              hand-off works anyway. A real portal would need the extension.
            </p>
          ) : null}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-[15px] font-semibold text-ink">Your prepared complaint</h3>
        <ul className="mt-3 divide-y divide-line">
          {prepared.payload.fields.map((field) => (
            <li key={field.key} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{field.label}</p>
                <p
                  className={`mt-1 text-sm text-ink ${field.multiline ? 'letter max-h-32 overflow-y-auto' : 'break-words'}`}
                >
                  {field.value}
                </p>
              </div>
              <Button size="sm" variant="secondary" className="shrink-0" onClick={() => copy(field.key, field.value)}>
                {copied === field.key ? 'Copied' : 'Copy'}
              </Button>
            </li>
          ))}
        </ul>

        {prepared.payload.evidence.length > 0 ? (
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Your evidence</p>
            <ul className="mt-2 space-y-1.5">
              {prepared.payload.evidence.map((item) => (
                <li key={item.evidenceId}>
                  <a
                    href={item.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
                  >
                    Download {item.label}
                  </a>
                </li>
              ))}
            </ul>
            {/* Browsers do not let a script populate a file input. Correctly so. */}
            <p className="mt-2 text-xs text-ink-muted">
              Attach these on the site yourself — no tool can put files into another site&apos;s upload box for you.
            </p>
          </div>
        ) : null}
      </Card>

      {/* The last step, and the one the whole tracking promise rests on. */}
      <Card className="p-5">
        <h3 className="text-[15px] font-semibold text-ink">When the site gives you a reference</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          Paste it here and CivicSOS starts tracking: it works out when to follow up, watches for a response, and
          prepares the escalation if nothing happens.
        </p>

        {recorded ? (
          <Alert tone="good" className="mt-4" icon={<IconCheck className="h-[18px] w-[18px]" />}>
            Recorded. Your case is now being tracked from today.
          </Alert>
        ) : (
          <div className="mt-4 space-y-3">
            {recordError ? (
              <Alert tone="bad" title="We could not record that">
                {recordError}
              </Alert>
            ) : null}

            <Field
              label="Complaint or reference number"
              htmlFor="official-reference"
              hint="Exactly as the official site showed it."
            >
              <Input
                id="official-reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="e.g. SWM/2026/118472"
                maxLength={120}
              />
            </Field>

            <Button loading={recording} disabled={reference.trim().length === 0} onClick={record}>
              Record it and start tracking
            </Button>
            <p className="text-xs text-ink-muted">
              Only do this once the site has actually confirmed your complaint. CivicSOS takes your word for it — it
              cannot see the official site.
            </p>
          </div>
        )}
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row">
        {prepared.channel.url ? (
          <a
            href={prepared.channel.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-6 text-[15px] font-medium text-white shadow-card transition-colors hover:bg-accent-hover"
          >
            <IconSend className="h-[18px] w-[18px]" />
            Open {new URL(prepared.channel.url).hostname}
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
        <Button variant="secondary" size="lg" onClick={onBack}>
          Back
        </Button>
      </div>


    </div>
  );
}
