// The ranks by points. As the app's src/lib/ranks.js (BOSSES[].min, icon):
// keep the two in step (test/crossRepo.test.js checks the thresholds).
const RANKS = [
  { name: 'Bronze',   min: 0,      icon: '⛺' },
  { name: 'Silver',   min: 1500,   icon: '🧊' },
  { name: 'Gold',     min: 5000,   icon: '🏔️' },
  { name: 'Platinum', min: 12000,  icon: '🌨️' },
  { name: 'Diamond',  min: 25000,  icon: '💀' },
  { name: 'Elite',    min: 45000,  icon: '⚡' },
  { name: 'Legend',   min: 75000,  icon: '🌪️' },
  { name: 'Mythic',   min: 120000, icon: '☄️' },
  { name: 'Immortal', min: 200000, icon: '♾️' },
];

function getRank(points) {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (points >= RANKS[i].min) {
      const next = RANKS[i + 1] || null;
      return {
        ...RANKS[i],
        nextRank:    next?.name || null,
        nextRankPts: next?.min  || null,
        progress: next
          ? Math.round(((points - RANKS[i].min) / (next.min - RANKS[i].min)) * 100)
          : 100,
      };
    }
  }
  return {
    ...RANKS[0],
    nextRank: RANKS[1].name,
    nextRankPts: RANKS[1].min,
    progress: Math.round((points / RANKS[1].min) * 100),
  };
}

module.exports = { RANKS, getRank };
