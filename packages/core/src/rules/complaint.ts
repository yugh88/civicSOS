import type { CategoryId, ComplaintDraft, LocationInput, Provenance } from '../domain/types.js';
import { getAuthority } from '../knowledge/authorities.js';
import { getResolutionPath } from '../knowledge/resolution-paths.js';
import { sanitizeLine, sanitizeText } from '../util/sanitize.js';

/**
 * Complaint drafting.
 *
 * The letter structure, the requests and the legal framing come from the
 * deterministic template in the knowledge layer. A model may improve the
 * free-text description, but it never decides what the citizen is asking for.
 *
 * Unknown values are left as visible `[[TOKEN]]` placeholders rather than being
 * invented — the UI highlights them so the citizen fills them in themselves.
 */

export const MAX_COMPLAINT_BODY = 6000;
export const MAX_COMPLAINT_SUBJECT = 200;

export interface ComplaintInputs {
  categoryId: CategoryId;
  description: string;
  location: LocationInput;
  sinceWhen?: string;
  hazardType?: string;
  riskToPeople?: string;
  householdsAffected?: string;
  consumerNumber?: string;
  reporterName?: string;
  reporterContact?: string;
  now?: Date;
}

/** Renders a location object as the single line that goes into the letter. */
export function formatLocation(location: LocationInput): string {
  const parts = [location.locality, location.city, location.state, location.pincode]
    .map((part) => sanitizeLine(part, 120))
    .filter((part) => part.length > 0);
  if (parts.length === 0) return '';
  return parts.join(', ');
}

const TOKEN_RE = /\[\[([A-Z_]+)\]\]/g;

/** Tokens the citizen is expected to complete themselves, by design. */
const USER_SUPPLIED_TOKENS = new Set(['YOUR_NAME', 'YOUR_CONTACT']);

function fill(template: string, values: Record<string, string | undefined>): { text: string; unresolved: string[] } {
  const unresolved = new Set<string>();
  const text = template.replace(TOKEN_RE, (match, token: string) => {
    const value = values[token];
    if (value && value.trim().length > 0) return value;
    unresolved.add(token);
    return match;
  });
  return { text, unresolved: [...unresolved] };
}

export function buildComplaintDraft(
  inputs: ComplaintInputs,
  provenance: Provenance = 'DETERMINISTIC_RULES',
): ComplaintDraft {
  const path = getResolutionPath(inputs.categoryId);
  const authority = getAuthority(path.authorityId);
  const now = inputs.now ?? new Date();

  const locationLine = formatLocation(inputs.location);
  const values: Record<string, string | undefined> = {
    LOCATION: locationLine,
    AUTHORITY_NAME: authority.name,
    DESCRIPTION: sanitizeText(inputs.description, 2000),
    SINCE_WHEN: inputs.sinceWhen ? sanitizeLine(inputs.sinceWhen, 120) : undefined,
    HAZARD_TYPE: inputs.hazardType ? sanitizeLine(inputs.hazardType, 200) : undefined,
    RISK_TO_PEOPLE: inputs.riskToPeople ? sanitizeLine(inputs.riskToPeople, 300) : undefined,
    HOUSEHOLDS_AFFECTED: inputs.householdsAffected ? sanitizeLine(inputs.householdsAffected, 60) : undefined,
    CONSUMER_NUMBER: inputs.consumerNumber ? sanitizeLine(inputs.consumerNumber, 60) : undefined,
    YOUR_NAME: inputs.reporterName ? sanitizeLine(inputs.reporterName, 120) : undefined,
    YOUR_CONTACT: inputs.reporterContact ? sanitizeLine(inputs.reporterContact, 120) : undefined,
    TODAY: now.toISOString().slice(0, 10),
  };

  const subject = fill(path.complaintTemplate.subject, values);
  const body = fill(path.complaintTemplate.body, values);

  // Name and contact are always the citizen's to provide; they are expected
  // placeholders rather than gaps in our knowledge.
  const placeholders = [...new Set([...subject.unresolved, ...body.unresolved])].sort((a, b) => {
    const aUser = USER_SUPPLIED_TOKENS.has(a) ? 1 : 0;
    const bUser = USER_SUPPLIED_TOKENS.has(b) ? 1 : 0;
    return aUser - bUser || a.localeCompare(b);
  });

  return {
    subject: subject.text.slice(0, MAX_COMPLAINT_SUBJECT),
    body: body.text.slice(0, MAX_COMPLAINT_BODY),
    placeholders,
    provenance,
    editedByUser: false,
  };
}

/** Human-readable prompts for the remaining placeholders, shown in the review screen. */
const TOKEN_PROMPTS: Record<string, string> = {
  LOCATION: 'Add the street and a nearby landmark',
  SINCE_WHEN: 'Say how long the problem has been there',
  HAZARD_TYPE: 'Describe exactly what is dangerous',
  RISK_TO_PEOPLE: 'Say who is at risk right now',
  HOUSEHOLDS_AFFECTED: 'Roughly how many households are affected',
  CONSUMER_NUMBER: 'Your water consumer number, if you have one',
  YOUR_NAME: 'Your name, as you want it on the complaint',
  YOUR_CONTACT: 'A contact number or email for the authority to reply to',
  DESCRIPTION: 'Describe the problem in your own words',
};

export function describePlaceholder(token: string): string {
  return TOKEN_PROMPTS[token] ?? `Fill in ${token.toLowerCase().replace(/_/g, ' ')}`;
}

/**
 * Re-checks a user-edited complaint for remaining placeholders.
 * Called on every PATCH so the "ready to submit" state stays truthful.
 */
export function remainingPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(TOKEN_RE)) {
    const token = match[1];
    if (token) found.add(token);
  }
  return [...found].sort();
}
