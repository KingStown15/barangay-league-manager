/**
 * generateRoundRobinPairs(teamIds)
 * Classic "circle method" round robin scheduler.
 * Returns an array of rounds, each round is an array of [teamA, teamB] pairs.
 * If there's an odd number of teams, a null "bye" is inserted.
 */
function generateRoundRobinPairs(teamIds) {
  const ids = [...teamIds];
  if (ids.length < 2) return { rounds: [], hasBye: false };

  let hasBye = false;
  if (ids.length % 2 !== 0) {
    ids.push(null); // bye
    hasBye = true;
  }

  const n = ids.length;
  const rounds = [];
  const arr = [...ids];

  for (let round = 0; round < n - 1; round++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== null && b !== null) pairs.push([a, b]);
    }
    rounds.push(pairs);
    // Rotate all but the first element
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr.splice(0, arr.length, fixed, ...rest);
  }

  return { rounds, hasBye };
}

/**
 * Splits a list of team IDs into N groups, distributing as evenly as possible
 * using round-robin (modulo) distribution so groups stay balanced in size.
 */
function splitIntoGroups(teamIds, groupsCount) {
  const groups = Array.from({ length: groupsCount }, () => []);
  const shuffled = [...teamIds];
  shuffled.forEach((teamId, idx) => {
    groups[idx % groupsCount].push(teamId);
  });
  return groups;
}

module.exports = { generateRoundRobinPairs, splitIntoGroups };
