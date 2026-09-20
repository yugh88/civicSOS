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
  /**
   * When set, the hand-off is delivered only to a page whose path begins with
   * this. The practice portal shares CivicSOS's own origin, so origin alone
   * would hand the complaint to the next CivicSOS page that happened to load.
   */
  targetPathPrefix?: string;
  payload: SubmissionPayload;
}

export type AssistantState =
  | { phase: 'IDLE' }
  /** A login, OTP or CAPTCHA is on screen. The assistant does nothing. */
  | { phase: 'WAITING_FOR_YOU'; reason: string }
  /** `practice` is true only on the CivicSOS practice portal, and is said out
   *  loud in the panel so a fill there is never mistaken for a real filing. */
  | { phase: 'READY'; filled: number; skipped: string[]; practice: boolean }
  | { phase: 'REVIEW_ONLY'; reason: string };
