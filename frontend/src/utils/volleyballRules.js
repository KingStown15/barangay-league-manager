export function isVolleyballChampionship(roundLabel) {
  return ['final', 'finals', 'championship'].includes(String(roundLabel || '').trim().toLowerCase());
}

export function getVolleyballSetsToWin(roundLabel) {
  return isVolleyballChampionship(roundLabel) ? 3 : 2;
}

export function getVolleyballFinalValidation(roundLabel, scoreA, scoreB) {
  const setsToWin = getVolleyballSetsToWin(roundLabel);
  const winnerSets = Math.max(scoreA, scoreB);
  const loserSets = Math.min(scoreA, scoreB);
  if (winnerSets !== setsToWin || loserSets >= setsToWin) {
    return setsToWin === 3
      ? 'Championship volleyball results must be first-to-3 sets (3-0, 3-1, or 3-2).'
      : 'Preliminary and knockout volleyball results must be first-to-2 sets (2-0 or 2-1).';
  }
  return '';
}
