import type { AgentStep, CaseRecord, EvidenceItem, SubmissionChannel } from '../domain/types.js';
import { AppError } from '../domain/errors.js';
import { getAuthority } from '../knowledge/authorities.js';
import { getResolutionPath } from '../knowledge/resolution-paths.js';
import { getCategory } from '../knowledge/categories.js';
import { formatLocation } from '../rules/complaint.js';

/**
 * Submission providers.
 *
 * There is more than one honest way to get a complaint to an authority, and they
 * have very different guarantees. Rather than hard-coding either into the agent,
 * each is a provider with the same shape:
 *
 *  - `DEMO`     — the simulator. A pure function, no network, `CS-DEMO-`
 *                 references. Guaranteed to work, guaranteed not to be real.
 *  - `OFFICIAL` — prepares a structured payload for a **verified** official
 *                 channel and hands it to the citizen (or to the browser
 *                 assistant). CivicSOS never claims this was submitted; only
 *                 the official site can confirm that.
 *  - `ASSIST`   — the same payload, marked for the browser extension, which
 *                 fills only configured fields and always stops before Submit.
 *
 * What no provider may do: invent a URL, invent a field, bypass a login, a
 * CAPTCHA or an OTP, store a government credential, or report a submission the
 * authority has not confirmed.
 */

export const SUBMISSION_PROVIDERS = ['DEMO', 'OFFICIAL', 'ASSIST'] as const;
export type SubmissionProviderId = (typeof SUBMISSION_PROVIDERS)[number];

/** One field CivicSOS can supply. Field *names* are the portal's, not ours. */
export interface PayloadField {
  /** Stable key the browser assistant maps to a selector, per portal. */
  key: string;
  /** What this is, in plain language, for the review panel. */
  label: string;
  value: string;
  /** Long values go in a textarea; short ones in an input. */
  multiline?: boolean;
}

export interface SubmissionPayload {
  caseId: string;
  categoryId: string;
  categoryLabel: string;
  /** Ordered for a human reading them down a form. */
  fields: PayloadField[];
  /**
   * Evidence as short-lived signed URLs. The assistant can offer them for
   * download so the citizen attaches them; it never uploads on their behalf,
   * because a file input cannot be set programmatically without a real user
   * gesture in any browser worth trusting.
   */
  evidence: Array<{ evidenceId: string; label: string; contentType: string; downloadUrl: string }>;
}

export interface PreparedSubmission {
  provider: SubmissionProviderId;
  /** The verified channel this payload is for. */
  channel: SubmissionChannel;
  authorityName: string;
  /** False when the only channel available is a generic template. */
  channelVerified: boolean;
  payload: SubmissionPayload;
  /** Steps the agent completed while preparing. */
  steps: AgentStep[];
  /**
   * What CivicSOS will and will not do next, shown verbatim to the citizen.
   * Written here rather than in the UI so the guarantee travels with the data.
   */
  boundaries: string[];
}

/**
 * Builds the structured payload from the case.
 *
 * Every value is something the citizen already wrote or approved. Nothing is
 * generated here, and nothing about their identity beyond what is already in
 * the complaint letter is included.
 */
export function buildPayload(record: CaseRecord, evidence: EvidenceItem[], downloadUrls: Map<string, string>): SubmissionPayload {
  const category = getCategory(record.categoryId);
  const place = formatLocation(record.location);

  const fields: PayloadField[] = [
    { key: 'category', label: 'Complaint category', value: category.label },
    { key: 'subject', label: 'Subject', value: record.complaint.subject },
    { key: 'location', label: 'Location', value: place || 'Not specified' },
  ];

  if (record.location.city) fields.push({ key: 'city', label: 'City', value: record.location.city });
  if (record.location.state) fields.push({ key: 'state', label: 'State', value: record.location.state });
  if (record.location.pincode) fields.push({ key: 'pincode', label: 'Postal code', value: record.location.pincode });

  fields.push({ key: 'description', label: 'Complaint details', value: record.complaint.body, multiline: true });

  return {
    caseId: record.caseId,
    categoryId: record.categoryId,
    categoryLabel: category.label,
    fields,
    evidence: evidence
      .filter((item) => item.confirmed)
      .map((item) => ({
        evidenceId: item.evidenceId,
        label: item.label ?? 'Evidence',
        contentType: item.contentType,
        downloadUrl: downloadUrls.get(item.evidenceId) ?? '',
      }))
      .filter((item) => item.downloadUrl.length > 0),
  };
}

/**
 * Picks the channel to hand off to.
 *
 * Only a channel already marked verified in the knowledge layer is offered for
 * the official path. If the category has none, this refuses rather than sending
 * a citizen to a generic template dressed up as an official destination.
 */
export function resolveOfficialChannel(record: CaseRecord): { channel: SubmissionChannel; authorityName: string } {
  const authority = getAuthority(getResolutionPath(record.categoryId).authorityId);
  const verified = authority.channels.find((channel) => !channel.isSample && Boolean(channel.url));

  if (!verified) {
    throw AppError.conflict(
      'We do not have a verified online channel for this category yet. Use the channels listed on your case, or run the demo submission to see how the workflow works.',
    );
  }

  return { channel: verified, authorityName: authority.name };
}

/**
 * The promises attached to an official hand-off.
 *
 * Deliberately data rather than UI copy: whatever surface renders this, the
 * limits travel with it.
 */
export const OFFICIAL_BOUNDARIES: string[] = [
  'CivicSOS opens the official site in a new tab. You stay in control of it.',
  'It fills only the fields it has been configured for on that site, and nothing else.',
  'If the site asks you to sign in, solve a CAPTCHA or enter an OTP, CivicSOS stops and waits for you. It never handles those, and never stores any credential.',
  'It always stops before the final Submit. You read everything and press Submit yourself.',
  'Your case is only marked submitted once you tell CivicSOS the reference the site gave you.',
];

/** Provider metadata, for the chooser. */
export const PROVIDER_INFO: Record<SubmissionProviderId, { label: string; blurb: string; realWorld: boolean }> = {
  DEMO: {
    label: 'Demo Simulation',
    blurb: 'See CivicSOS complete the whole workflow safely. Nothing reaches any authority.',
    realWorld: false,
  },
  OFFICIAL: {
    label: 'Official Website',
    blurb: 'Open the verified official channel with your complaint prepared and ready to paste.',
    realWorld: true,
  },
  ASSIST: {
    label: 'Official Website',
    blurb: 'Open the verified official channel and let the CivicSOS browser assistant fill the supported fields.',
    realWorld: true,
  },
};
