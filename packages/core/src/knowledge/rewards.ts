import type { RewardRecord } from '../domain/types.js';

/**
 * Reward catalogue.
 *
 * HONESTY POLICY — read before editing.
 *
 * Every entry below is a **placeholder with a fictional partner**, flagged
 * `isSampleCatalog: true` and badged "Demo catalogue" in the UI. CivicSOS has no
 * confirmed sponsors, so it does not name real brands, and redemption issues a
 * clearly-marked demo code rather than anything of value.
 *
 * The shape is the real one. A deployment with actual partners replaces these
 * records, sets `isSampleCatalog: false`, and swaps `RewardsService.issueCode`
 * for a partner integration — no other code changes. No commerce API, paid
 * service or payment flow is involved at any point in the MVP.
 */

export const REWARDS: RewardRecord[] = [
  {
    rewardId: 'voucher-local-cafe',
    partner: 'Corner Chai Co. (demo partner)',
    name: '₹100 café voucher',
    description: 'A cup of chai and a samosa, on the house, at a participating neighbourhood café.',
    category: 'VOUCHER',
    pointsRequired: 150,
    emoji: '☕',
    isSampleCatalog: true,
  },
  {
    rewardId: 'voucher-bookstore',
    partner: 'Margin Notes Books (demo partner)',
    name: '₹250 bookstore voucher',
    description: 'Spend it on anything in store, including the local-history shelf.',
    category: 'VOUCHER',
    pointsRequired: 300,
    emoji: '📚',
    isSampleCatalog: true,
  },
  {
    rewardId: 'product-tote',
    partner: 'CivicSOS',
    name: 'CivicSOS canvas tote',
    description: 'Printed with "I reported it." Made from recycled cotton.',
    category: 'PRODUCT',
    pointsRequired: 200,
    emoji: '👜',
    isSampleCatalog: true,
  },
  {
    rewardId: 'product-bottle',
    partner: 'CivicSOS',
    name: 'Insulated steel bottle',
    description: 'Because the answer to bad municipal water should not be more plastic.',
    category: 'PRODUCT',
    pointsRequired: 450,
    emoji: '🍶',
    isSampleCatalog: true,
  },
  {
    rewardId: 'voucher-transit',
    partner: 'City Transit (demo partner)',
    name: 'Ten-trip metro pass',
    description: 'Ten rides on the city metro, valid for three months.',
    category: 'VOUCHER',
    pointsRequired: 500,
    emoji: '🚇',
    isSampleCatalog: true,
  },
  {
    rewardId: 'experience-heritage-walk',
    partner: 'City Heritage Walks (demo partner)',
    name: 'Guided heritage walk for two',
    description: 'A two-hour guided walk through the old quarter, led by a local historian.',
    category: 'EXPERIENCE',
    pointsRequired: 600,
    emoji: '🏛️',
    isSampleCatalog: true,
    minLevel: 'SILVER',
  },
  {
    rewardId: 'experience-tree-planting',
    partner: 'Green Streets Collective (demo partner)',
    name: 'Plant a tree in your ward',
    description: 'A sapling planted and geo-tagged in your own ward, with a photo sent to you.',
    category: 'EXPERIENCE',
    pointsRequired: 750,
    emoji: '🌳',
    isSampleCatalog: true,
    minLevel: 'SILVER',
  },
  {
    rewardId: 'experience-civic-roundtable',
    partner: 'CivicSOS',
    name: 'Seat at the civic roundtable',
    description: 'An invitation to a quarterly session with other active reporters in your city.',
    category: 'EXPERIENCE',
    pointsRequired: 1200,
    emoji: '🎟️',
    isSampleCatalog: true,
    minLevel: 'GOLD',
  },
];

export function getReward(rewardId: string): RewardRecord | undefined {
  return REWARDS.find((reward) => reward.rewardId === rewardId);
}

/** Shown wherever the catalogue appears. */
export const REWARDS_DISCLAIMER =
  'This is a demo catalogue. CivicSOS has no confirmed sponsors, the partners listed here are ' +
  'fictional, and redeeming issues a sample code with no monetary value. The points, levels and ' +
  'redemption flow are real — only the partners are placeholders.';
