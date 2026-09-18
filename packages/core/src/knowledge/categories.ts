import type { CategoryId, CategoryRecord } from '../domain/types.js';

/**
 * Category knowledge records.
 *
 * These drive both the category picker in the UI and the deterministic
 * classifier that runs when Gemini is unavailable or returns junk. Adding a
 * category is a data change here plus a resolution path — no code changes.
 */
export const CATEGORIES: Record<CategoryId, CategoryRecord> = {
  ROAD_DAMAGE: {
    categoryId: 'ROAD_DAMAGE',
    label: 'Roads & potholes',
    description: 'Potholes, broken roads, damaged footpaths, missing manhole covers.',
    emoji: '🛣️',
    keywords: [
      'pothole', 'potholes', 'road', 'roads', 'street', 'tar', 'asphalt', 'crater',
      'footpath', 'sidewalk', 'pavement', 'speed breaker', 'divider', 'kerb', 'curb',
      'manhole', 'road dug', 'dug up', 'uneven', 'bumpy', 'gravel', 'resurfac',
    ],
    strongSignals: [
      'pothole', 'road is broken', 'broken road', 'damaged road', 'road damage',
      'open manhole', 'manhole cover', 'footpath broken', 'road caved',
    ],
    defaultUrgency: 'MEDIUM',
    hazardSignals: ['accident', 'injured', 'fell', 'two wheeler', 'open manhole', 'caved in', 'sinkhole'],
  },

  GARBAGE_SANITATION: {
    categoryId: 'GARBAGE_SANITATION',
    label: 'Garbage & sanitation',
    description: 'Uncollected waste, overflowing bins, illegal dumping, public toilets.',
    emoji: '🗑️',
    keywords: [
      'garbage', 'trash', 'rubbish', 'waste', 'kachra', 'kooda', 'dump', 'dumping',
      'bin', 'dustbin', 'litter', 'sanitation', 'sweeping', 'sweeper', 'debris',
      'malba', 'stink', 'smell', 'rotting', 'flies', 'compost', 'toilet', 'sulabh',
      'not collected', 'not been collected', 'pickup', 'collection',
    ],
    strongSignals: [
      'garbage not collected', 'garbage outside', 'overflowing bin', 'garbage pile',
      'illegal dumping', 'waste not picked', 'trash not collected', 'dumping site',
    ],
    defaultUrgency: 'MEDIUM',
    hazardSignals: ['medical waste', 'dead animal', 'biohazard', 'dengue', 'infection', 'maggots'],
  },

  STREETLIGHT: {
    categoryId: 'STREETLIGHT',
    label: 'Streetlights',
    description: 'Dark streets, flickering or broken lamps, exposed wiring on poles.',
    emoji: '💡',
    keywords: [
      'streetlight', 'street light', 'streetlamp', 'street lamp', 'lamp post', 'lamppost',
      'light not working', 'bulb', 'dark', 'darkness', 'unlit', 'flicker', 'pole',
      'lighting', 'no light', 'lights off', 'led',
    ],
    strongSignals: [
      'street light not working', 'streetlight not working', 'street is dark',
      'lights are not working', 'lamp post broken', 'no street light',
    ],
    defaultUrgency: 'MEDIUM',
    hazardSignals: ['exposed wire', 'live wire', 'sparking', 'shock', 'electrocut', 'unsafe for women', 'snatching'],
  },

  WATER_SEWERAGE: {
    categoryId: 'WATER_SEWERAGE',
    label: 'Water & sewerage',
    description: 'No water supply, leaks, contaminated water, blocked or overflowing drains.',
    emoji: '🚰',
    keywords: [
      'water', 'pani', 'supply', 'tap', 'pipeline', 'pipe', 'leak', 'leakage', 'burst',
      'sewage', 'sewerage', 'sewer', 'drain', 'drainage', 'nala', 'nallah', 'gutter',
      'overflow', 'overflowing', 'blocked', 'choked', 'contaminated', 'muddy water',
      'dirty water', 'smelly water', 'no water', 'waterlogging', 'water logging', 'flooded',
      'borewell', 'tanker', 'septic',
    ],
    strongSignals: [
      'no water supply', 'water leak', 'pipeline burst', 'sewage overflow',
      'drain blocked', 'drain is overflowing', 'contaminated water', 'dirty water coming',
      'water logging', 'sewer overflowing',
    ],
    defaultUrgency: 'HIGH',
    hazardSignals: ['contaminated', 'diarrhea', 'cholera', 'sick', 'ill', 'flooded house', 'knee deep', 'drowning'],
  },

  PUBLIC_SAFETY_HAZARD: {
    categoryId: 'PUBLIC_SAFETY_HAZARD',
    label: 'Public safety hazard',
    description: 'Fallen trees or poles, exposed electrical wires, unsafe structures, open pits.',
    emoji: '⚠️',
    keywords: [
      'hazard', 'danger', 'dangerous', 'unsafe', 'risk', 'fallen tree', 'tree fell',
      'branch', 'electric pole', 'transformer', 'exposed wire', 'live wire', 'wire hanging',
      'spark', 'sparking', 'short circuit', 'open pit', 'ditch', 'collapse', 'collapsed',
      'building unsafe', 'wall', 'debris blocking', 'stray dog', 'encroachment',
      'traffic signal', 'signal not working', 'accident prone',
    ],
    strongSignals: [
      'live wire', 'exposed wire', 'wires hanging', 'tree has fallen', 'fallen tree',
      'transformer sparking', 'building is collapsing', 'wall collapsed', 'open pit',
      'someone could die', 'electrocution risk',
    ],
    defaultUrgency: 'HIGH',
    hazardSignals: ['live wire', 'electrocut', 'collapse', 'death', 'died', 'injured', 'child', 'fire', 'gas leak'],
  },

  OTHER: {
    categoryId: 'OTHER',
    label: 'Something else',
    description: "A civic problem that doesn't fit the categories above.",
    emoji: '📋',
    keywords: [],
    strongSignals: [],
    defaultUrgency: 'MEDIUM',
  },
};

/** Ordered list for UI rendering. `OTHER` always comes last. */
export const CATEGORY_LIST: CategoryRecord[] = [
  CATEGORIES.ROAD_DAMAGE,
  CATEGORIES.GARBAGE_SANITATION,
  CATEGORIES.STREETLIGHT,
  CATEGORIES.WATER_SEWERAGE,
  CATEGORIES.PUBLIC_SAFETY_HAZARD,
  CATEGORIES.OTHER,
];

export function getCategory(categoryId: CategoryId): CategoryRecord {
  return CATEGORIES[categoryId] ?? CATEGORIES.OTHER;
}
