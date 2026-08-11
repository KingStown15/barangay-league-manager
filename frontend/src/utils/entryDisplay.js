function sideKey(side) {
  return String(side).toLowerCase() === 'b' ? 'b' : 'a';
}

export function formatEntryLabel(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getGameSideEntry(game, side) {
  return game?.[`side_${sideKey(side)}`] || null;
}

export function getGameSideName(game, side, fallback = 'TBD') {
  const key = sideKey(side);
  return getGameSideEntry(game, key)?.display_name || game?.[`team_${key}_name`] || fallback;
}

export function getGameSideId(game, side) {
  const key = sideKey(side);
  return game?.[`side_${key}_entry_id`] || game?.[`team_${key}_id`] || null;
}

export function hasGameSides(game) {
  return Boolean(getGameSideId(game, 'a') && getGameSideId(game, 'b'));
}

export function getMatchupLabel(game) {
  return `${getGameSideName(game, 'a')} vs ${getGameSideName(game, 'b')}`;
}

export function getEntryShortLabel(entry, fallback = 'TBD') {
  if (!entry) return fallback;
  if (entry.entry_type !== 'pair' || !entry.members?.length) return entry.display_name || fallback;
  return entry.members.map((member) => {
    const parts = String(member.display_name || '').trim().split(/\s+/);
    return parts.at(-1) || member.display_name;
  }).join(' / ');
}

export function getGameSideShortName(game, side) {
  const entry = getGameSideEntry(game, side);
  return getEntryShortLabel(entry, getGameSideName(game, side));
}

export function getEntryAccessibleLabel(entry, fallback = 'Competitor') {
  if (!entry) return fallback;
  const type = entry.entry_type === 'pair' ? 'Pair' : entry.entry_type === 'individual' ? 'Player' : 'Team';
  const affiliation = entry.affiliation ? `, ${entry.affiliation}` : '';
  return `${type}: ${entry.display_name || fallback}${affiliation}`;
}

export function getGameDivision(game, tournament) {
  return getGameSideEntry(game, 'a')?.division || getGameSideEntry(game, 'b')?.division || game?.tournament_division || tournament?.division || tournament?.category || null;
}

export function getCompetitionLabel(game, tournament) {
  const format = tournament?.competition_format || game?.competition_format;
  return format ? formatEntryLabel(format) : null;
}

export function isPickleballGame(game, tournament) {
  return (game?.sport || tournament?.sport) === 'pickleball';
}

export function getCompletedGameBreakdown(game) {
  return game?.pickleball?.completed_games || [];
}

export function formatCompletedGames(game) {
  return getCompletedGameBreakdown(game)
    .map((completed) => `${completed.side_a_points}–${completed.side_b_points}`)
    .join(', ');
}
