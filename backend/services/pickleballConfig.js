const DIVISIONS = ['men', 'women', 'mixed', 'open', 'custom'];
const SCORING_MODES = ['side_out', 'rally'];

function configError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function integer(value, label, { min = 1, max = 99 } = {}) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw configError(`${label} must be a whole number between ${min} and ${max}.`);
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') throw configError(`${label} must be true or false.`);
  return value;
}

function normalizePickleballConfig(input = {}, existing = null) {
  const source = { ...(existing || {}), ...(input.sport_config || {}), ...input };
  const competitionFormat = source.competition_format;
  if (!['singles', 'doubles'].includes(competitionFormat)) {
    throw configError('Pickleball competition_format must be singles or doubles.');
  }
  const division = source.division;
  if (!DIVISIONS.includes(division)) throw configError('Invalid Pickleball division.');
  if (division === 'mixed' && competitionFormat !== 'doubles') {
    throw configError('Mixed Pickleball requires doubles competition format.');
  }
  const customDivision = division === 'custom'
    ? String(source.custom_division || '').trim()
    : null;
  if (division === 'custom' && (!customDivision || customDivision.length > 80)) {
    throw configError('Custom division is required and must be 80 characters or fewer.');
  }
  const scoringMode = source.scoring_mode ?? 'side_out';
  if (!SCORING_MODES.includes(scoringMode)) throw configError('Invalid Pickleball scoring mode.');
  const gamesToWin = integer(source.games_to_win ?? 2, 'Games to win', { min: 1, max: 5 });
  const standardTarget = integer(source.points_to_win_standard_game ?? 11, 'Standard game target', { min: 1, max: 99 });
  const decidingTarget = integer(source.points_to_win_deciding_game ?? standardTarget, 'Deciding game target', { min: 1, max: 99 });
  const winBy = integer(source.win_by ?? 2, 'Win-by margin', { min: 1, max: 10 });
  let scoreCap = source.score_cap ?? null;
  if (scoreCap !== null && scoreCap !== '') {
    scoreCap = integer(scoreCap, 'Score cap', { min: 1, max: 199 });
    if (scoreCap < standardTarget || scoreCap < decidingTarget) {
      throw configError('Score cap cannot be lower than a game target.');
    }
  } else {
    scoreCap = null;
  }
  const trackService = source.track_service ?? true;
  const trackServerNumber = source.track_server_number ?? competitionFormat === 'doubles';
  const sideSwitchEnabled = source.side_switch_enabled ?? true;
  boolean(trackService, 'track_service');
  boolean(trackServerNumber, 'track_server_number');
  boolean(sideSwitchEnabled, 'side_switch_enabled');
  if (competitionFormat === 'singles' && trackServerNumber) {
    throw configError('Server number tracking is only available for doubles.');
  }
  let sideSwitchPoint = source.side_switch_point ?? Math.ceil(decidingTarget / 2);
  if (sideSwitchEnabled) {
    sideSwitchPoint = integer(sideSwitchPoint, 'Side-switch point', { min: 1, max: 99 });
    if (sideSwitchPoint >= decidingTarget) throw configError('Side-switch point must be below the deciding game target.');
  } else {
    sideSwitchPoint = null;
  }

  const config = {
    schema_version: 1,
    competition_format: competitionFormat,
    division,
    custom_division: customDivision,
    scoring_mode: scoringMode,
    games_to_win: gamesToWin,
    points_to_win_standard_game: standardTarget,
    points_to_win_deciding_game: decidingTarget,
    win_by: winBy,
    score_cap: scoreCap,
    allow_tied_final: false,
    track_service: trackService,
    track_server_number: trackServerNumber,
    side_switch_enabled: sideSwitchEnabled,
    side_switch_point: sideSwitchPoint,
  };
  const category = division === 'custom'
    ? customDivision
    : ({ men: "Men's", women: "Women's", mixed: 'Mixed', open: 'Open' })[division];
  return { competitionFormat, division, category, config };
}

function parsePickleballConfig(tournament) {
  if (!tournament?.sport_config_json) return null;
  try {
    return JSON.parse(tournament.sport_config_json);
  } catch {
    throw configError('Tournament Pickleball configuration is invalid.');
  }
}

module.exports = { DIVISIONS, normalizePickleballConfig, parsePickleballConfig };
