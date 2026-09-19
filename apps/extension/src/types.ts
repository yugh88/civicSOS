/**
 * The contract between the CivicSOS web app and the browser assistant.
 *
 * Deliberately small and free of anything sensitive: there is no credential
 * field here, and there never will be. The assistant receives a complaint the
 * citizen has already read and approved, and nothing else.
 */

export interface PayloadField {
  /** Stable key a mapping resolves to a selector. */
  key: string;
  label: string;
  value: string;
  multiline?: boolean;
}

export interface SubmissionPayload {
  caseId: string;
  categoryId: string;
  categoryLabel: string;
  fields: PayloadField[];
  evidence: Array<{ evidenceId: string; label: string; contentType: string; downloadUrl: string }>;
}

export interface HandoffMessage {
  type: 'CIVICSOS_HANDOFF';
  /** Origin of the verified channel this payload is meant for. */
  targetOrigin: string;
  payload: SubmissionPayload;
}

export type AssistantState =
  | { phase: 'IDLE' }
  /** A login, OTP or CAPTCHA is on screen. The assistant does nothing. */
  | { phase: 'WAITING_FOR_YOU'; reason: string }
  | { phase: 'READY'; filled: number; skipped: string[] }
  | { phase: 'REVIEW_ONLY'; reason: string };
