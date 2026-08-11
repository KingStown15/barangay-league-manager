/**
 * Builds a single-elimination bracket from an ordered (seeded) list of team IDs.
 * Seed 1 plays the lowest seed, etc. Standard bracket seeding with byes for
 * non-power-of-2 team counts, so the strongest seeds skip round 1 if needed.
 *
 * Returns an array of rounds; each round is an array of matchup descriptors:
 *   { slot, teamAId, teamBId, teamASeed, teamBSeed, feedsSlot }
 * A null id means "winner of an earlier match" (filled in once games are created).
 */
function nextPowerOf2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function standardSeedOrder(size) {
  // Recursive standard bracket seeding e.g. for 8: 1,8,4,5,2,7,3,6
  if (size === 1) return [1];
  if (size === 2) return [1, 2];
  const half = standardSeedOrder(size / 2);
  const out = [];
  half.forEach((seed) => {
    out.push(seed);
    out.push(size + 1 - seed);
  });
  return out;
}

function generateSingleEliminationBracket(seededTeamIds, roundNamer) {
  const seedCount = seededTeamIds.length;
  const bracketSize = nextPowerOf2(seedCount);
  const order = standardSeedOrder(bracketSize);

  // seed -> teamId, seeds beyond seedCount are byes (null)
  const seedToTeam = {};
  order.forEach((seed) => {
    seedToTeam[seed] = seed <= seedCount ? seededTeamIds[seed - 1] : null;
  });

  const totalRounds = Math.log2(bracketSize);
  const rounds = [];
  let currentRoundSlots = [];

  // Round 1 straight from seed order
  for (let i = 0; i < bracketSize; i += 2) {
    currentRoundSlots.push({
      slot: `R1-${i / 2 + 1}`,
      teamAId: seedToTeam[order[i]],
      teamBId: seedToTeam[order[i + 1]],
      teamASeed: order[i] <= seedCount ? order[i] : null,
      teamBSeed: order[i + 1] <= seedCount ? order[i + 1] : null,
    });
  }
  rounds.push({
    roundNumber: 1,
    name: roundNamer ? roundNamer(1, totalRounds) : defaultRoundName(1, totalRounds),
    matches: currentRoundSlots,
  });

  let prevRoundSlots = currentRoundSlots;
  for (let r = 2; r <= totalRounds; r++) {
    const roundSlots = [];
    for (let i = 0; i < prevRoundSlots.length; i += 2) {
      const slotName = `R${r}-${i / 2 + 1}`;
      roundSlots.push({
        slot: slotName,
        teamAId: null,
        teamBId: null,
        feedsFrom: [prevRoundSlots[i].slot, prevRoundSlots[i + 1].slot],
      });
      prevRoundSlots[i].feedsSlot = slotName;
      prevRoundSlots[i].feedsSide = 'A';
      prevRoundSlots[i + 1].feedsSlot = slotName;
      prevRoundSlots[i + 1].feedsSide = 'B';
    }
    rounds.push({
      roundNumber: r,
      name: roundNamer ? roundNamer(r, totalRounds) : defaultRoundName(r, totalRounds),
      matches: roundSlots,
    });
    prevRoundSlots = roundSlots;
  }

  // Auto-advance byes: if one side of a round-1 match is a bye (null team),
  // the present team advances immediately into the feeding slot.
  autoAdvanceByes(rounds);

  return rounds;
}

function autoAdvanceByes(rounds) {
  const round1 = rounds[0];
  round1.matches.forEach((m) => {
    const isByeA = m.teamAId === null && m.teamBId !== null;
    const isByeB = m.teamBId === null && m.teamAId !== null;
    if ((isByeA || isByeB) && m.feedsSlot) {
      const advancingTeam = isByeA ? m.teamBId : m.teamAId;
      m.byeWinner = advancingTeam;
      const nextRound = rounds[1];
      const target = nextRound.matches.find((nm) => nm.slot === m.feedsSlot);
      if (target) {
        if (m.feedsSide === 'A') target.teamAId = advancingTeam;
        else target.teamBId = advancingTeam;
      }
    }
  });
}

function defaultRoundName(roundNumber, totalRounds) {
  const remaining = totalRounds - roundNumber;
  if (remaining === 0) return 'Final';
  if (remaining === 1) return 'Semifinals';
  if (remaining === 2) return 'Quarterfinals';
  return `Round ${roundNumber}`;
}

/**
 * Builds subsequent rounds (semis onward, or whatever follows) from a fixed,
 * already-decided first round of pairs - used for the group playoff case
 * where round 1 pairings are dictated by group placement (A1 vs B2, etc.)
 * rather than by seed math. `pairs` must be a power-of-2 length array of
 * [teamAId, teamBId].
 */
function buildBracketFromFixedPairs(pairs, roundNamer) {
  const totalRounds = Math.log2(pairs.length) + 1;
  const rounds = [];

  let prevRoundSlots = pairs.map(([a, b], idx) => ({
    slot: `R1-${idx + 1}`,
    teamAId: a,
    teamBId: b,
  }));
  rounds.push({
    roundNumber: 1,
    name: roundNamer(1, totalRounds),
    matches: prevRoundSlots,
  });

  for (let r = 2; r <= totalRounds; r++) {
    const roundSlots = [];
    for (let i = 0; i < prevRoundSlots.length; i += 2) {
      const slotName = `R${r}-${i / 2 + 1}`;
      roundSlots.push({ slot: slotName, teamAId: null, teamBId: null });
      prevRoundSlots[i].feedsSlot = slotName;
      prevRoundSlots[i].feedsSide = 'A';
      prevRoundSlots[i + 1].feedsSlot = slotName;
      prevRoundSlots[i + 1].feedsSide = 'B';
    }
    rounds.push({ roundNumber: r, name: roundNamer(r, totalRounds), matches: roundSlots });
    prevRoundSlots = roundSlots;
  }

  return rounds;
}

/**
 * Builds the playoff pairing for the "groups + playoffs" default format.
 * Standard barangay pattern for 2 groups: A1 vs B2, B1 vs A2 in the semis.
 * For other group counts (or more than 2 advancing per group), falls back
 * to overall seeding by group position, fed through standard bracket seeding.
 */
function generateGroupPlayoffMatchups(groupsWithStandings, advancingPerGroup, includeThirdPlace) {
  const groupCount = groupsWithStandings.length;
  const roundNamer = (roundNum, total) => {
    if (roundNum === total) return 'Final';
    if (roundNum === total - 1) return 'Semifinals';
    if (roundNum === total - 2) return 'Quarterfinals';
    return `Round ${roundNum}`;
  };

  let rounds;
  if (groupCount === 2 && advancingPerGroup === 2) {
    const [g1, g2] = groupsWithStandings;
    // SF1: A1 vs B2, SF2: B1 vs A2
    const firstRoundPairs = [
      [g1.standings[0].teamId, g2.standings[1].teamId],
      [g2.standings[0].teamId, g1.standings[1].teamId],
    ];
    rounds = buildBracketFromFixedPairs(firstRoundPairs, roundNamer);
  } else {
    const seededTeams = [];
    for (let position = 0; position < advancingPerGroup; position++) {
      groupsWithStandings.forEach((g) => {
        if (g.standings[position]) seededTeams.push(g.standings[position].teamId);
      });
    }
    rounds = generateSingleEliminationBracket(seededTeams, roundNamer);
  }

  return { rounds, includeThirdPlace: !!includeThirdPlace };
}

module.exports = {
  generateSingleEliminationBracket,
  generateGroupPlayoffMatchups,
  standardSeedOrder,
  nextPowerOf2,
};
