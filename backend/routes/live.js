const express = require('express');
const sse = require('../live/sseHub');

module.exports = function liveRoutes(db) {
  const router = express.Router();

  router.get('/events', (req, res) => {
    const tournamentId = Number(req.query.tournament_id);
    if (!Number.isSafeInteger(tournamentId) || tournamentId < 1) {
      return res.status(400).json({ error: 'A valid tournament_id is required.' });
    }
    const tournament = db.prepare(
      "SELECT id FROM tournaments WHERE id = ? AND status IN ('active', 'completed')"
    ).get(tournamentId);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', tournament_id: tournamentId })}\n\n`);

    sse.addClient(tournamentId, res);

    const heartbeat = setInterval(() => {
      try { res.write(`:heartbeat\n\n`); } catch { clearInterval(heartbeat); }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sse.removeClient(tournamentId, res);
    });
  });

  return router;
};
