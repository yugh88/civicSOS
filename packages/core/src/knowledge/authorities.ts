import type { AuthorityRecord, SubmissionChannel } from '../domain/types.js';

/**
 * Authority knowledge records.
 *
 * HONESTY POLICY — read before editing.
 *
 * CivicSOS must never invent a government contact or present unverified
 * information as official. So this file contains exactly two kinds of record:
 *
 *  1. GENERIC TEMPLATES (`isSample: true`) — the *type* of body that handles a
 *     problem ("your city's municipal corporation, engineering wing"). These
 *     carry no invented phone numbers or city URLs. Instead they tell the
 *     citizen how to reach the real body for their own jurisdiction and route
 *     them through nationally available official channels.
 *
 *  2. NATIONAL CHANNELS (`isSample: false`) — a small set of well-known,
 *     genuinely government-operated entry points, listed with their official
 *     domains only.
 *
 * Any deployment that wants verified, city-specific directories should load
 * them into the Authority table (see ARCHITECTURE.md → "Extending knowledge").
 * Until then the UI renders a visible "generic guidance" badge.
 */

/**
 * Government of India's central public grievance portal. Used as a real,
 * nationally available escalation channel for every category.
 */
const CPGRAMS: SubmissionChannel = {
  kind: 'WEB_PORTAL',
  label: 'CPGRAMS — Government of India public grievance portal',
  url: 'https://pgportal.gov.in/',
  isSample: false,
  note: 'Central grievance portal. Best used when a local body has not responded, or to escalate.',
};

/**
 * MoHUA's Swachhata platform for municipal sanitation complaints. Nationally
 * available and routed to the citizen's own urban local body.
 */
const SWACHHATA: SubmissionChannel = {
  kind: 'MOBILE_APP',
  label: 'Swachhata app (Ministry of Housing & Urban Affairs)',
  url: 'https://swachhatalive.sbmurban.org/',
  isSample: false,
  note: 'Routes sanitation and waste complaints to your own urban local body.',
};

/** National emergency number. Included only for genuine emergencies. */
const EMERGENCY_112: SubmissionChannel = {
  kind: 'PHONE',
  label: 'Emergency helpline',
  value: '112',
  isSample: false,
  note: 'For immediate danger to life or property, call this first — before filing any complaint.',
};

/** NHAI helpline, for problems on national highways specifically. */
const NHAI_1033: SubmissionChannel = {
  kind: 'PHONE',
  label: 'National Highways helpline (NHAI)',
  value: '1033',
  isSample: false,
  note: 'Only for national highways. City roads are handled by your municipal body.',
};

/**
 * The instruction we give instead of inventing a city portal URL. Deliberately
 * teaches the citizen how to find their own authority.
 */
function localBodyChannel(department: string): SubmissionChannel {
  return {
    kind: 'WEB_PORTAL',
    label: `Your city's municipal grievance portal — ${department}`,
    isSample: true,
    note:
      'CivicSOS does not ship a verified directory of city portals. Search for ' +
      '"<your city> municipal corporation grievance" and prefer a gov.in / nic.in ' +
      'domain, or use the official national channels listed here.',
  };
}

function localBodyHelpline(department: string): SubmissionChannel {
  return {
    kind: 'PHONE',
    label: `Your city's civic helpline — ${department}`,
    isSample: true,
    note:
      'Most municipal corporations publish a helpline on their official website. ' +
      'CivicSOS does not guess the number for your city.',
  };
}

export const AUTHORITIES: Record<string, AuthorityRecord> = {
  MUNICIPAL_ROADS: {
    authorityId: 'MUNICIPAL_ROADS',
    name: 'Municipal corporation — roads & engineering wing',
    jurisdictionLevel: 'MUNICIPAL',
    scope: 'City roads, footpaths, manholes and road surfaces inside municipal limits.',
    channels: [localBodyChannel('roads / engineering'), localBodyHelpline('roads'), NHAI_1033, CPGRAMS],
    isSample: true,
    sourceNote:
      'Generic template describing the type of body that handles city roads. Not a verified ' +
      'directory entry for your specific city.',
  },

  MUNICIPAL_SANITATION: {
    authorityId: 'MUNICIPAL_SANITATION',
    name: 'Municipal corporation — sanitation & solid waste management',
    jurisdictionLevel: 'MUNICIPAL',
    scope: 'Door-to-door collection, street sweeping, public bins, illegal dumping.',
    channels: [SWACHHATA, localBodyChannel('sanitation / SWM'), localBodyHelpline('sanitation'), CPGRAMS],
    isSample: true,
    sourceNote:
      'Generic template. The Swachhata app is an official national channel that forwards ' +
      'the complaint to your own urban local body.',
  },

  MUNICIPAL_STREETLIGHT: {
    authorityId: 'MUNICIPAL_STREETLIGHT',
    name: 'Municipal corporation — street lighting / electrical wing',
    jurisdictionLevel: 'MUNICIPAL',
    scope: 'Street lighting on municipal roads. Distribution-company poles may be separate.',
    channels: [localBodyChannel('street lighting'), localBodyHelpline('street lighting'), CPGRAMS],
    isSample: true,
    sourceNote:
      'Generic template. In some cities street lighting sits with the electricity distribution ' +
      'company rather than the corporation — the complaint text says this explicitly.',
  },

  WATER_UTILITY: {
    authorityId: 'WATER_UTILITY',
    name: 'Water supply & sewerage board / municipal water department',
    jurisdictionLevel: 'UTILITY',
    scope: 'Piped water supply, quality, leaks, sewer lines and storm-water drains.',
    channels: [localBodyChannel('water supply & sewerage'), localBodyHelpline('water / sewerage'), CPGRAMS],
    isSample: true,
    sourceNote:
      'Generic template. Depending on the city this is a state water board, a jal board, or a ' +
      'department of the municipal corporation.',
  },

  SAFETY_MULTI: {
    authorityId: 'SAFETY_MULTI',
    name: 'Emergency services, then the owning civic body',
    jurisdictionLevel: 'MUNICIPAL',
    scope:
      'Immediate hazards. Emergency services first; the follow-up complaint goes to whichever ' +
      'body owns the asset (corporation, electricity distribution company, or disaster cell).',
    channels: [EMERGENCY_112, localBodyChannel('disaster management / electrical'), CPGRAMS],
    isSample: true,
    sourceNote:
      'Generic template. Safety hazards are deliberately routed to emergency services first — ' +
      'CivicSOS never asks a citizen to wait on a written complaint when there is danger to life.',
  },

  GENERAL_GRIEVANCE: {
    authorityId: 'GENERAL_GRIEVANCE',
    name: 'General public grievance redressal',
    jurisdictionLevel: 'NATIONAL',
    scope: 'Civic problems that do not map to a specific department.',
    channels: [CPGRAMS, localBodyChannel('general grievance')],
    isSample: true,
    sourceNote:
      'Fallback route. CPGRAMS is a genuine Government of India portal; the local entry is a ' +
      'generic template.',
  },
};

export function getAuthority(authorityId: string): AuthorityRecord {
  return AUTHORITIES[authorityId] ?? AUTHORITIES.GENERAL_GRIEVANCE!;
}

/** Shown alongside every plan so the citizen knows exactly what they are looking at. */
export const KNOWLEDGE_DISCLAIMER =
  'CivicSOS gives you generic civic guidance and a complaint you can use. It does not ship a ' +
  'verified directory of city offices, it is not affiliated with any government body, and it ' +
  'does not file complaints on your behalf — you submit through the official channel yourself. ' +
  'Always confirm the department and contact details on your own city or state official website.';
