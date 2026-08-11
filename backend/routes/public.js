const express = require('express');
const { computeStandings } = require('../services/standingsService');
const { GAME_ENTRY_JOINS, GAME_ENTRY_SELECT, serializeGamesWithEntries } = require('../services/entryResolver');

module.exports = function publicRoutes(db) {
  const router = express.Router();

  // List of tournaments that are visible to the public (active or completed)
  router.get('/tournaments', (req, res) => {
    const tournaments = db.prepare(
      "SELECT id, name, sport, category, competition_format, division, format, venue, start_date, end_date, status FROM tournaments WHERE status IN ('active','completed') ORDER BY created_at DESC"
    ).all();
    res.json({ tournaments });
  });

  router.get('/tournaments/:id', (req, res) => {
    const tournament = db.prepare(
      "SELECT id, name, sport, category, competition_format, division, format, venue, start_date, end_date, status, rules FROM tournaments WHERE id = ? AND status IN ('active','completed')"
    ).get(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
    res.json({ tournament });
  });

  function verifyTournamentExists(tid) {
    const t = db.prepare(
      "SELECT id FROM tournaments WHERE id = ? AND status IN ('active','completed')"
    ).get(tid);
    if (!t) return null;
    return t;
  }

  function computeEffectiveClockValues(game) {
    const nowMs = Date.now();
    if (game.game_clock_running && game.game_clock_started_at && game.game_clock_remaining !== null) {
      const startedAtMs = new Date(game.game_clock_started_at).getTime();
      const elapsed = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
      game.game_clock_remaining = Math.max(0, game.game_clock_remaining - elapsed);
      // Keep the timestamp aligned with this effective snapshot. Public clock
      // clients continue ticking from here instead of subtracting the entire
      // pre-response elapsed interval a second time.
      game.game_clock_started_at = new Date(startedAtMs + (elapsed * 1000)).toISOString();
    }
    if (game.shot_clock_running && game.shot_clock_started_at && game.shot_clock_remaining !== null) {
      const startedAtMs = new Date(game.shot_clock_started_at).getTime();
      const elapsed = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
      game.shot_clock_remaining = Math.max(0, game.shot_clock_remaining - elapsed);
      game.shot_clock_started_at = new Date(startedAtMs + (elapsed * 1000)).toISOString();
    }
    return game;
  }

  router.get('/tournaments/:id/schedule', (req, res) => {
    if (!verifyTournamentExists(req.params.id)) return res.status(404).json({ error: 'Tournament not found.' });
    const games = db.prepare(
      `SELECT g.id, g.round_label, g.bracket_slot, g.scheduled_at, g.venue, g.status, g.score_a, g.score_b,
               g.live_score_a, g.live_score_b, g.team_a_id, g.team_b_id, g.side_a_entry_id, g.side_b_entry_id,
               g.current_period, g.game_clock_remaining, g.game_clock_running, g.game_clock_started_at,
               g.shot_clock_remaining, g.shot_clock_running, g.shot_clock_started_at,
               t.sport, t.competition_format, t.division AS tournament_division,
               ta.name AS team_a_name, tb.name AS team_b_name, gt.name AS group_name ${GAME_ENTRY_SELECT}
       FROM games g
       LEFT JOIN teams ta ON ta.id = g.team_a_id
       LEFT JOIN teams tb ON tb.id = g.team_b_id
       LEFT JOIN groups_table gt ON gt.id = g.group_id
       ${GAME_ENTRY_JOINS}
       JOIN tournaments t ON t.id = g.tournament_id
       WHERE g.tournament_id = ? AND g.status IN ('scheduled','ongoing','postponed')
       ORDER BY g.scheduled_at IS NULL, g.scheduled_at`
    ).all(req.params.id);
    games.forEach(computeEffectiveClockValues);
    res.json({ games: serializeGamesWithEntries(db, games, { publicSafe: true }) });
  });

  router.get('/tournaments/:id/results', (req, res) => {
    if (!verifyTournamentExists(req.params.id)) return res.status(404).json({ error: 'Tournament not found.' });
    const games = db.prepare(
      `SELECT g.id, g.round_label, g.bracket_slot, g.scheduled_at, g.status, g.score_a, g.score_b, g.live_score_a, g.live_score_b,
              g.forfeit_team_id, g.team_a_id, g.team_b_id, g.side_a_entry_id, g.side_b_entry_id,
              g.winner_team_id, g.winner_entry_id, g.approved_at, t.sport, t.competition_format, t.division AS tournament_division,
              ta.name AS team_a_name, tb.name AS team_b_name, gt.name AS group_name ${GAME_ENTRY_SELECT}
       FROM games g
       LEFT JOIN teams ta ON ta.id = g.team_a_id
       LEFT JOIN teams tb ON tb.id = g.team_b_id
       LEFT JOIN groups_table gt ON gt.id = g.group_id
       ${GAME_ENTRY_JOINS}
       JOIN tournaments t ON t.id = g.tournament_id
       WHERE g.tournament_id = ? AND g.status IN ('completed','forfeited') AND g.approved_at IS NOT NULL
       ORDER BY g.scheduled_at IS NULL, g.scheduled_at DESC`
    ).all(req.params.id);
    res.json({ games: serializeGamesWithEntries(db, games, { publicSafe: true }) });
  });

  router.get('/tournaments/:id/pending-results', (req, res) => {
    if (!verifyTournamentExists(req.params.id)) return res.status(404).json({ error: 'Tournament not found.' });
    const games = db.prepare(
      `SELECT g.id, g.round_label, g.bracket_slot, g.scheduled_at, g.venue, g.status, g.score_a, g.score_b,
              g.live_score_a, g.live_score_b, g.team_a_id, g.team_b_id, g.side_a_entry_id, g.side_b_entry_id,
              g.approved_at, t.sport, t.competition_format, t.division AS tournament_division,
              ta.name AS team_a_name, tb.name AS team_b_name, gt.name AS group_name ${GAME_ENTRY_SELECT}
       FROM games g
       LEFT JOIN teams ta ON ta.id = g.team_a_id
       LEFT JOIN teams tb ON tb.id = g.team_b_id
       LEFT JOIN groups_table gt ON gt.id = g.group_id
       ${GAME_ENTRY_JOINS}
       JOIN tournaments t ON t.id = g.tournament_id
       WHERE g.tournament_id = ? AND g.status IN ('completed','forfeited') AND g.approved_at IS NULL
         AND (g.score_a IS NOT NULL OR g.forfeit_team_id IS NOT NULL)
       ORDER BY g.scheduled_at IS NULL, g.scheduled_at DESC`
    ).all(req.params.id);
    res.json({ games: serializeGamesWithEntries(db, games, { publicSafe: true }) });
  });

  router.get('/tournaments/:id/standings', (req, res) => {
    if (!verifyTournamentExists(req.params.id)) return res.status(404).json({ error: 'Tournament not found.' });
    try {
      const groups = db.prepare('SELECT * FROM groups_table WHERE tournament_id = ? ORDER BY order_index').all(req.params.id);
      if (groups.length === 0) {
        return res.json({ groups: [{ group: null, standings: computeStandings(db, req.params.id, null) }] });
      }
      const result = groups.map((g) => ({ group: g, standings: computeStandings(db, req.params.id, g.id) }));
      res.json({ groups: result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/tournaments/:id/bracket', (req, res) => {
    if (!verifyTournamentExists(req.params.id)) return res.status(404).json({ error: 'Tournament not found.' });
    const stage = db.prepare(
      "SELECT * FROM stages WHERE tournament_id = ? AND type = 'playoff' ORDER BY order_index DESC LIMIT 1"
    ).get(req.params.id);
    if (!stage) return res.json({ stage: null, games: [] });
    const games = db.prepare(
      `SELECT g.id, g.round_label, g.bracket_slot, g.status, g.score_a, g.score_b, g.live_score_a, g.live_score_b,
              g.winner_team_id, g.winner_entry_id, g.team_a_id, g.team_b_id, g.side_a_entry_id, g.side_b_entry_id,
              g.approved_at, t.sport, t.competition_format, t.division AS tournament_division,
              ta.name AS team_a_name, tb.name AS team_b_name ${GAME_ENTRY_SELECT}
       FROM games g
       LEFT JOIN teams ta ON ta.id = g.team_a_id
       LEFT JOIN teams tb ON tb.id = g.team_b_id
       ${GAME_ENTRY_JOINS}
       JOIN tournaments t ON t.id = g.tournament_id
       WHERE g.stage_id = ?
       ORDER BY g.id`
    ).all(stage.id);
    res.json({ stage, games: serializeGamesWithEntries(db, games, { publicSafe: true }) });
  });

  return router;
};
