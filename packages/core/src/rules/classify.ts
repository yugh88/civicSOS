import { CATEGORY_LIST, getCategory } from '../knowledge/categories.js';
import type { CategoryId, Urgency } from '../domain/types.js';

/**
 * Deterministic keyword classifier.
 *
 * This is not a toy fallback — it is the guarantee that CivicSOS keeps working
 * when Gemini is rate-limited, slow or returns malformed JSON. It also acts as a
 * sanity check on the model: if the model's category disagrees wildly with a
 * confident keyword match, we ask the citizen to confirm rather than silently
 * routing the complaint to the wrong department.
 */

export interface ClassificationScore {
  categoryId: CategoryId;
  score: number;
  matched: string[];
}

export interface ClassificationResult {
  categoryId: CategoryId;
  /** 0–1. Below `CONFIRMATION_THRESHOLD` the UI asks the user to confirm. */
  confidence: number;
  urgency: Urgency;
  /** All non-zero scores, highest first. Useful for the admin/debug view. */
  scores: ClassificationScore[];
  /** True when no category scored at all. */
  ambiguous: boolean;
}

/** Below this confidence we always ask the citizen to confirm the category. */
export const CONFIRMATION_THRESHOLD = 0.45;

const STRONG_SIGNAL_WEIGHT = 6;
const KEYWORD_WEIGHT = 2;
/** Multi-word keywords are more specific than single words, so they score higher. */
const PHRASE_BONUS = 1;

function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;
}

/** Whole-word/phrase containment, so "water" does not match "waterproofing". */
function contains(haystack: string, needle: string): boolean {
  const term = needle.toLowerCase().trim();
  if (!term) return false;
  return haystack.includes(` ${term} `) || haystack.includes(` ${term}s `);
}

export function scoreCategories(text: string): ClassificationScore[] {
  const haystack = normalize(text);
  const scores: ClassificationScore[] = [];

  for (const category of CATEGORY_LIST) {
    if (category.categoryId === 'OTHER') continue;
    let score = 0;
    const matched: string[] = [];

    for (const signal of category.strongSignals) {
      if (contains(haystack, signal)) {
        score += STRONG_SIGNAL_WEIGHT;
        matched.push(signal);
      }
    }
    for (const keyword of category.keywords) {
      if (contains(haystack, keyword)) {
        score += KEYWORD_WEIGHT + (keyword.includes(' ') ? PHRASE_BONUS : 0);
        matched.push(keyword);
      }
    }

    if (score > 0) scores.push({ categoryId: category.categoryId, score, matched });
  }

  return scores.sort((a, b) => b.score - a.score);
}

/**
 * Derives urgency from hazard language plus the category's baseline.
 *
 * Urgency is never taken from the model alone: a complaint that mentions a live
 * wire or an injury must come out HIGH/CRITICAL regardless of what any model says.
 */
export function assessUrgency(text: string, categoryId: CategoryId): Urgency {
  const haystack = normalize(text);
  const category = getCategory(categoryId);
  let urgency: Urgency = category.defaultUrgency;

  const hazardHits = (category.hazardSignals ?? []).filter((signal) => contains(haystack, signal)).length;
  if (hazardHits > 0) urgency = 'HIGH';

  const criticalSignals = [
    'live wire', 'electrocut', 'gas leak', 'fire', 'collapsed', 'collapse',
    'died', 'death', 'dead', 'drowning', 'unconscious', 'bleeding', 'emergency',
  ];
  const injurySignals = ['injured', 'injury', 'accident', 'hospital', 'fracture', 'hurt', 'sick', 'ill'];

  if (criticalSignals.some((signal) => contains(haystack, signal))) return 'CRITICAL';
  if (injurySignals.some((signal) => contains(haystack, signal))) {
    urgency = urgency === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
  }

  // A long-standing problem is not an emergency, but it is not LOW either.
  if (urgency === 'LOW' && /\b(?:weeks?|months?|years?)\b/.test(haystack)) urgency = 'MEDIUM';

  return urgency;
}

/**
 * Confidence is the winning score's share of total score, damped by how much
 * signal we saw at all. Two sentences with one weak keyword should not produce
 * 100% confidence just because only one category matched.
 */
function computeConfidence(scores: ClassificationScore[]): number {
  const top = scores[0];
  if (!top) return 0;
  const total = scores.reduce((sum, entry) => sum + entry.score, 0);
  const share = top.score / total;
  // Saturates at a score of 8, i.e. one strong signal or a few keywords.
  const evidence = Math.min(1, top.score / 8);
  return Math.round(share * evidence * 100) / 100;
}

export function classifyDeterministic(text: string): ClassificationResult {
  const scores = scoreCategories(text);
  const top = scores[0];

  if (!top) {
    return {
      categoryId: 'OTHER',
      confidence: 0,
      urgency: assessUrgency(text, 'OTHER'),
      scores: [],
      ambiguous: true,
    };
  }

  return {
    categoryId: top.categoryId,
    confidence: computeConfidence(scores),
    urgency: assessUrgency(text, top.categoryId),
    scores,
    ambiguous: false,
  };
}

/**
 * Reconciles the model's category with the deterministic one.
 *
 * Rules, in order:
 *  - They agree → use it, confidence boosted.
 *  - Keywords found nothing → trust the model (that is what it is good at).
 *  - The model says OTHER but keywords are confident → trust the keywords.
 *  - They disagree and keywords are confident → keep the keyword category and
 *    flag it for user confirmation. Routing a sewage complaint to the roads
 *    department is worse than one extra tap from the citizen.
 */
export function reconcileCategory(
  modelCategory: CategoryId,
  deterministic: ClassificationResult,
): { categoryId: CategoryId; confidence: number; needsConfirmation: boolean } {
  if (deterministic.ambiguous) {
    return {
      categoryId: modelCategory,
      confidence: modelCategory === 'OTHER' ? 0.3 : 0.6,
      needsConfirmation: modelCategory === 'OTHER',
    };
  }

  if (modelCategory === deterministic.categoryId) {
    const confidence = Math.min(1, deterministic.confidence + 0.35);
    return { categoryId: modelCategory, confidence, needsConfirmation: false };
  }

  if (modelCategory === 'OTHER') {
    return {
      categoryId: deterministic.categoryId,
      confidence: deterministic.confidence,
      needsConfirmation: deterministic.confidence < CONFIRMATION_THRESHOLD,
    };
  }

  // Genuine disagreement: prefer the explainable side and ask the human.
  const winner = deterministic.confidence >= 0.6 ? deterministic.categoryId : modelCategory;
  return { categoryId: winner, confidence: 0.4, needsConfirmation: true };
}
