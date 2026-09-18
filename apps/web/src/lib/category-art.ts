/**
 * Category artwork.
 *
 * Local SVG scenes rather than photographs or a hotlinked stock library: they
 * are a few kilobytes each, stay crisp from a 64px case thumbnail to a full-
 * width card, need no image CDN or optimizer, and cannot break because a remote
 * host went away. They also keep one consistent visual language across the
 * product, which stock photography would not.
 */

const ART: Record<string, string> = {
  ROAD_DAMAGE: '/illustrations/categories/road.svg',
  GARBAGE_SANITATION: '/illustrations/categories/garbage.svg',
  STREETLIGHT: '/illustrations/categories/streetlight.svg',
  WATER_SEWERAGE: '/illustrations/categories/water.svg',
  PUBLIC_SAFETY_HAZARD: '/illustrations/categories/safety.svg',
  OTHER: '/illustrations/categories/other.svg',
};

export function categoryArt(categoryId: string): string {
  return ART[categoryId] ?? ART.OTHER!;
}

/** Short, scannable descriptions used on the home page's category cards. */
export const CATEGORY_BLURB: Record<string, string> = {
  ROAD_DAMAGE: 'Potholes, broken footpaths, open manholes',
  GARBAGE_SANITATION: 'Uncollected waste, overflowing bins, dumping',
  STREETLIGHT: 'Dark streets, broken lamps, exposed wiring',
  WATER_SEWERAGE: 'No supply, leaks, contamination, blocked drains',
  PUBLIC_SAFETY_HAZARD: 'Fallen trees, live wires, unsafe structures',
  OTHER: 'Anything else your local body should handle',
};

/** Alt text. Describes the subject, not the artwork. */
export const CATEGORY_ALT: Record<string, string> = {
  ROAD_DAMAGE: 'A damaged road surface',
  GARBAGE_SANITATION: 'Overflowing waste bins',
  STREETLIGHT: 'A dark street with a broken light',
  WATER_SEWERAGE: 'A leaking water pipe',
  PUBLIC_SAFETY_HAZARD: 'A street hazard',
  OTHER: 'A neighbourhood street',
};
