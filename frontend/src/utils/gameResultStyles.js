export function hasScoreValue(value) {
  return value !== null && value !== undefined && value !== '';
}

export function hasScorePair(a, b) {
  return hasScoreValue(a) && hasScoreValue(b);
}

export function isApprovedFinal(game) {
  return Boolean(game?.approved_at || game?.approvedAt);
}

export function getWinnerSide(game) {
  if (!isApprovedFinal(game)) return null;

  const winnerId = game?.winner_entry_id || game?.winnerEntryId || game?.winner_team_id || game?.winnerTeamId;
  const teamAId = game?.side_a_entry_id || game?.sideAEntryId || game?.team_a_id || game?.teamAId;
  const teamBId = game?.side_b_entry_id || game?.sideBEntryId || game?.team_b_id || game?.teamBId;

  if (winnerId && teamAId && String(winnerId) === String(teamAId)) return 'A';
  if (winnerId && teamBId && String(winnerId) === String(teamBId)) return 'B';

  const scoreA = game?.score_a;
  const scoreB = game?.score_b;

  if (scoreA === null || scoreA === undefined || scoreB === null || scoreB === undefined) {
    return null;
  }

  if (Number(scoreA) > Number(scoreB)) return 'A';
  if (Number(scoreB) > Number(scoreA)) return 'B';

  return null;
}

export const WINNER_COLOR = '#16A34A';
export const LOSER_COLOR = '#EF4444';

export function getTeamColor(game, side) {
  const ws = getWinnerSide(game);
  if (!ws) return undefined;
  return ws === side ? WINNER_COLOR : LOSER_COLOR;
}

export function getTeamWeight(game, side) {
  const ws = getWinnerSide(game);
  if (!ws) return undefined;
  return ws === side ? 700 : 500;
}
