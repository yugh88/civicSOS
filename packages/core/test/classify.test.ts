import { describe, expect, it } from 'vitest';
import { assessUrgency, classifyDeterministic, reconcileCategory } from '../src/rules/classify.js';

describe('deterministic classifier', () => {
  it('classifies the five supported categories from natural phrasing', () => {
    const cases: Array<[string, string]> = [
      ['There is a huge pothole right outside our gate and bikes keep skidding on it', 'ROAD_DAMAGE'],
      ['There has been garbage outside my apartment for 4 days and nobody has collected it', 'GARBAGE_SANITATION'],
      ['The street light on our lane has not been working for two weeks', 'STREETLIGHT'],
      ['No water supply in our building since yesterday morning', 'WATER_SEWERAGE'],
      ['There is a live wire hanging from the electric pole near the school', 'PUBLIC_SAFETY_HAZARD'],
    ];
    for (const [text, expected] of cases) {
      expect(classifyDeterministic(text).categoryId, text).toBe(expected);
    }
  });

  it('returns OTHER and flags ambiguity when nothing matches', () => {
    const result = classifyDeterministic('I would like to know the office timings for my ward');
    expect(result.categoryId).toBe('OTHER');
    expect(result.ambiguous).toBe(true);
    expect(result.confidence).toBe(0);
  });

  it('does not match a keyword inside an unrelated longer word', () => {
    // "waterproofing" must not trigger the water category.
    const result = classifyDeterministic('The waterproofing quote for our terrace was too expensive');
    expect(result.categoryId).not.toBe('WATER_SEWERAGE');
  });

  it('gives low confidence when two categories compete', () => {
    const result = classifyDeterministic('Garbage is blocking the road near our street');
    expect(result.scores.length).toBeGreaterThan(1);
    expect(result.confidence).toBeLessThan(0.8);
  });
});

describe('urgency assessment', () => {
  it('escalates to CRITICAL on life-threatening language', () => {
    expect(assessUrgency('A live wire is lying on the footpath', 'PUBLIC_SAFETY_HAZARD')).toBe('CRITICAL');
    expect(assessUrgency('The compound wall has collapsed onto the road', 'PUBLIC_SAFETY_HAZARD')).toBe('CRITICAL');
  });

  it('raises urgency to HIGH when someone was hurt', () => {
    expect(assessUrgency('A rider was injured after hitting the pothole', 'ROAD_DAMAGE')).toBe('HIGH');
  });

  it('keeps ordinary disrepair at the category default', () => {
    expect(assessUrgency('There is a pothole on the road', 'ROAD_DAMAGE')).toBe('MEDIUM');
  });
});

describe('reconciliation between the model and the rules', () => {
  const confident = classifyDeterministic('garbage not collected outside my apartment for 4 days');

  it('boosts confidence when both agree', () => {
    const result = reconcileCategory('GARBAGE_SANITATION', confident);
    expect(result.categoryId).toBe('GARBAGE_SANITATION');
    expect(result.needsConfirmation).toBe(false);
    expect(result.confidence).toBeGreaterThanOrEqual(confident.confidence);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('prefers the keyword category and asks the user when they disagree', () => {
    const result = reconcileCategory('ROAD_DAMAGE', confident);
    expect(result.needsConfirmation).toBe(true);
    expect(result.categoryId).toBe('GARBAGE_SANITATION');
  });

  it('trusts the model when keywords found nothing', () => {
    const ambiguous = classifyDeterministic('the situation near our colony has become intolerable');
    const result = reconcileCategory('WATER_SEWERAGE', ambiguous);
    expect(result.categoryId).toBe('WATER_SEWERAGE');
  });

  it('keeps the keyword category when the model gives up with OTHER', () => {
    const result = reconcileCategory('OTHER', confident);
    expect(result.categoryId).toBe('GARBAGE_SANITATION');
  });
});
