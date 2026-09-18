import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Button, Card, SectionHeading } from '@/components/ui';

export const metadata: Metadata = {
  title: 'How CivicSOS works',
  description: 'What CivicSOS does, what it does not do, and how it handles your information.',
};

/**
 * The honesty page.
 *
 * Every claim a civic tool makes about government process is a claim someone
 * might act on, so this page states plainly what is generic guidance, what is
 * official, what the AI does and does not decide, and what happens to a
 * citizen's data. It is linked from the footer of every screen.
 */
export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">How CivicSOS works</h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">
          CivicSOS exists because most people know exactly what is wrong on their street and have no idea what to do
          about it. It turns a sentence into a plan: who handles it, what evidence you need, what to send, where to
          send it, and what to do when nothing happens.
        </p>
      </div>

      <Alert tone="warn" title="What CivicSOS is not">
        <ul className="mt-1 space-y-1.5">
          <li>It is not a government service and is not affiliated with any government body.</li>
          <li>It does not submit complaints for you. You always submit through the official channel yourself.</li>
          <li>
            It does not ship a verified directory of city offices. Department names and processes are generic
            templates, clearly labelled as such, plus a small number of genuinely official national channels.
          </li>
        </ul>
      </Alert>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="What the AI does — and does not — decide" />
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink-muted">
          <p>
            An AI model reads your description and does four narrow things: works out which of our fixed categories
            it belongs to, writes a neutral one-line summary, tidies your words into something suitable for an
            official letter, and notices what you forgot to mention.
          </p>
          <p>
            It decides nothing else. Which authority handles the problem, what evidence is required, how long the
            response should take, when you should follow up, what the escalation path is, and what you are permitted
            to see — all of that comes from CivicSOS&apos;s own rules, which are fixed, reviewable and the same for
            everybody.
          </p>
          <p>
            That is also why CivicSOS keeps working when the AI does not. If the model is unavailable, slow, or
            returns something that does not fit the expected shape, the app falls back to its own classification and
            you still get a complete plan. You will see a note on the page when that happens, rather than a silent
            downgrade.
          </p>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="What happens to your information" />
        <ul className="mt-4 space-y-3 text-sm leading-relaxed text-ink-muted">
          <li>
            <span className="font-medium text-ink">Before anything goes to the AI</span>, we strip phone numbers,
            email addresses, government ID numbers and house or flat numbers out of your text. The model sees the
            civic problem, not who reported it.
          </li>
          <li>
            <span className="font-medium text-ink">Your cases are private to you.</span> Access is checked on the
            server on every single request. A case belonging to someone else does not just refuse to open — it
            reports as not found, so nobody can even confirm it exists.
          </li>
          <li>
            <span className="font-medium text-ink">Photos are private.</span> They live in private storage and are
            only ever served through links that expire in minutes, issued after we have checked the case is yours.
          </li>
          <li>
            <span className="font-medium text-ink">Locations are deliberately imprecise.</span> If you share your
            browser location, we round it to roughly a kilometre before storing it. We never keep your exact
            position.
          </li>
          <li>
            <span className="font-medium text-ink">Logs are scrubbed.</span> Our diagnostic logs redact emails,
            phone numbers and identifiers, so operating the service does not mean reading your details.
          </li>
        </ul>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="Demo data" />
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Choosing &quot;Try the demo&quot; gives you a private, temporary session with your own copy of four sample
          cases — including one deliberately old enough that the escalation guidance has unlocked. Every one of them
          is marked <span className="font-medium text-ink">Demo data</span>, the banner stays on screen for the whole
          session, and none of it is a real complaint to any authority.
        </p>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="If there is immediate danger" />
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Do not use CivicSOS. Call the emergency helpline on{' '}
          <a href="tel:112" className="font-semibold text-accent underline underline-offset-2">
            112
          </a>
          . A written complaint is the wrong tool when someone could be hurt in the next few minutes, and CivicSOS
          says so on any plan it builds for a safety hazard.
        </p>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link href="/">
          <Button>Report a problem</Button>
        </Link>
        <Link href="/signin?demo=1">
          <Button variant="secondary">Try the demo</Button>
        </Link>
      </div>
    </div>
  );
}
