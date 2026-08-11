import { useEffect, useState, useMemo } from 'react';
import { api } from '../api/client';
import PublicLayout from '../layouts/PublicLayout';
import { usePublicTournament } from '../utils/usePublicTournament';
import { usePolling } from '../utils/usePolling';
import { getWinnerSide } from '../utils/gameResultStyles';
import { formatCompletedGames, getGameSideName } from '../utils/entryDisplay';

const CARD_W = 248;
const CARD_H = 124;
const GAP = 28;
const COL_GAP = 18;
const PAD_LEFT = 24;
const BOTTOM_PAD = 32;

function classifyStage(name) {
  const s = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s.includes('quarter')) return 'quarterfinal';
  if (s.includes('round1')) return 'quarterfinal';
  if (s.includes('semi')) return 'semifinal';
  if (s.includes('round2')) return 'semifinal';
  if (s.includes('third') || s.includes('3rd') || s.includes('consolation')) return 'thirdplace';
  if (s.includes('final') || s.includes('championship')) return 'final';
  if (s.includes('champion')) return 'champion';
  return 'unknown';
}

function roundPriority(name) {
  const stage = classifyStage(name);
  if (stage === 'quarterfinal') return 0;
  if (stage === 'semifinal') return 1;
  if (stage === 'final') return 2;
  if (stage === 'champion') return 3;
  return 99;
}

function groupRounds(games) {
  const map = {};
  games.forEach(g => {
    const key = g.round_label || 'Round';
    if (!map[key]) map[key] = [];
    map[key].push(g);
  });
  return Object.entries(map)
    .sort((a, b) => roundPriority(a[0]) - roundPriority(b[0]))
    .map(([name, gs]) => ({
      name,
      games: gs.sort((a, b) => (a.game_order || 0) - (b.game_order || 0)),
    }));
}

function buildBracketLayout(games) {
  if (!games.length) return null;

  // Group games by round_label, then separate Third Place from championship path
  const grouped = groupRounds(games);
  const championshipRounds = [];
  let thirdPlaceRound = null;

  grouped.forEach(r => {
    if (classifyStage(r.name) === 'thirdplace') {
      thirdPlaceRound = r;
    } else {
      championshipRounds.push(r);
    }
  });

  const rounds = championshipRounds;
  if (!rounds.length) return null;

  const firstCount = rounds[0].games.length;
  const finalsCol = rounds.length - 1;
  const finalRound = rounds[finalsCol];
  const finalGame = finalRound?.games?.[0];

  // Champion derived only from the Finals/Championship winner
  const champion = (finalGame && finalGame.status === 'completed' && finalGame.approved_at && getWinnerSide(finalGame))
    ? finalGame
    : null;

  const cards = [];
  const connectors = [];

  // Position championship cards left-to-right by round
  rounds.forEach((round, ri) => {
    round.games.forEach((game, gi) => {
      const factor = Math.pow(2, ri);
      const slotMid = gi * factor + (factor - 1) / 2;
      const x = PAD_LEFT + ri * (CARD_W + COL_GAP);
      const y = slotMid * (CARD_H + GAP);
      cards.push({ game, x, y, ri, gi });
    });
  });

  // Connectors between consecutive championship rounds only
  for (let ri = 0; ri < rounds.length - 1; ri++) {
    const cur = cards.filter(c => c.ri === ri);
    const nxt = cards.filter(c => c.ri === ri + 1);
    for (let gi = 0; gi < cur.length; gi += 2) {
      const a = cur[gi], b = cur[gi + 1];
      if (!b) continue;
      const target = nxt[Math.floor(gi / 2)];
      if (!target) continue;
      const rX = a.x + CARD_W;
      const jX = (rX + target.x) / 2;
      const acy = a.y + CARD_H / 2;
      const bcy = b.y + CARD_H / 2;
      const jY = (acy + bcy) / 2;
      connectors.push(
        { x1: rX, y1: acy, x2: jX, y2: acy },
        { x1: rX, y1: bcy, x2: jX, y2: bcy },
        { x1: jX, y1: acy, x2: jX, y2: bcy },
        { x1: jX, y1: jY, x2: target.x, y2: jY }
      );
    }
  }

  // Position Third Place card(s) below the Finals column
  let thirdPlaceCardX = 0;
  let thirdPlaceCardY = 0;
  if (thirdPlaceRound) {
    thirdPlaceCardX = PAD_LEFT + finalsCol * (CARD_W + COL_GAP);
    const maxCardBottom = cards.reduce((m, c) => Math.max(m, c.y + CARD_H), 0);
    thirdPlaceCardY = maxCardBottom + GAP;
  }

  // Position champion card to the right of the Finals column
  let championCard = null;
  if (champion) {
    const championCol = rounds.length;
    const x = PAD_LEFT + championCol * (CARD_W + COL_GAP);
    const finalCard = cards.find(c => c.ri === finalsCol);
    const y = finalCard ? finalCard.y : 0;
    championCard = { game: champion, x, y, ri: championCol, gi: 0 };

    if (finalCard) {
      const rX = finalCard.x + CARD_W;
      const jX = (rX + x) / 2;
      const acy = finalCard.y + CARD_H / 2;
      connectors.push(
        { x1: rX, y1: acy, x2: jX, y2: acy },
        { x1: jX, y1: acy, x2: x, y2: acy }
      );
    }
  }

  // Canvas sizing
  const totalCols = rounds.length + (champion ? 1 : 0);
  const canvasW = PAD_LEFT + totalCols * (CARD_W + COL_GAP) + PAD_LEFT;
  const lastCardBottom = cards.reduce((m, c) => Math.max(m, c.y + CARD_H), 0);
  const thirdBottom = thirdPlaceRound ? thirdPlaceCardY + CARD_H : 0;
  const canvasH = Math.max(lastCardBottom, thirdBottom) + BOTTOM_PAD;

  return { rounds, thirdPlaceRound, thirdPlaceCardX, thirdPlaceCardY, champion, cards, championCard, connectors, canvasW, canvasH };
}

function MatchCard({ game, style }) {
  const winnerSide = getWinnerSide(game);
  const winnerA = winnerSide === 'A';
  const winnerB = winnerSide === 'B';
  const isLive = game.status === 'ongoing';
  const scoreA = isLive ? game.live_score_a : game.score_a;
  const scoreB = isLive ? game.live_score_b : game.score_b;
  const sideAName = getGameSideName(game, 'a');
  const sideBName = getGameSideName(game, 'b');
  const breakdown = formatCompletedGames(game);

  return (
    <div className="public-card" style={{ position: 'absolute', width: CARD_W, height: CARD_H, padding: '12px 16px', display: 'flex', flexDirection: 'column', border: isLive ? '1px solid var(--color-primary)' : undefined, ...style }}>
      {isLive && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.11em', color: 'var(--color-primary)', marginBottom: '4px', flexShrink: 0 }}>
          <span className="live-dot" /> Live
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '8px', minHeight: '28px' }}>
          <span title={sideAName} className="bracket-entry-name" style={{ color: winnerA ? '#16A34A' : (winnerSide ? '#EF4444' : 'var(--color-text)'), fontWeight: winnerA ? 700 : (winnerSide ? 500 : undefined) }}>{sideAName}</span>
          {scoreA !== null && scoreA !== undefined && <span className="scoreboard-digits" style={{ fontSize: '14px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center' }}>{scoreA}</span>}
        </div>
        <div style={{ borderTop: '1px dashed var(--color-border)', margin: '6px 0' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '8px', minHeight: '28px' }}>
          <span title={sideBName} className="bracket-entry-name" style={{ color: winnerB ? '#16A34A' : (winnerSide ? '#EF4444' : 'var(--color-text)'), fontWeight: winnerB ? 700 : (winnerSide ? 500 : undefined) }}>{sideBName}</span>
          {scoreB !== null && scoreB !== undefined && <span className="scoreboard-digits" style={{ fontSize: '14px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center' }}>{scoreB}</span>}
        </div>
        {breakdown && <div className="bracket-game-breakdown">Games: {breakdown}</div>}
      </div>
    </div>
  );
}

function ChampionCard({ game, style }) {
  const winnerSide = getWinnerSide(game);
  const winnerName = winnerSide === 'A' ? getGameSideName(game, 'a') : getGameSideName(game, 'b');

  return (
    <div className="public-card" style={{ position: 'absolute', width: CARD_W, height: CARD_H, padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '3px', ...style }}>
      <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--color-primary)' }}>Champion</div>
      <div style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '-0.02em', color: 'var(--color-text)', textAlign: 'center', lineHeight: 1.2 }}>{winnerName}</div>
      {game.score_a !== null && game.score_a !== undefined && (
        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-muted)' }}>{game.score_a} &ndash; {game.score_b}</div>
      )}
    </div>
  );
}

function RoundHeader({ name, style }) {
  return (
    <div style={{ fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--color-primary)', textAlign: 'center', width: CARD_W, ...style }}>
      {name}
    </div>
  );
}

export default function PublicBracket() {
  const { tournament, tournamentId } = usePublicTournament();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const verifiedTournamentId = tournament?.id;

  useEffect(() => {
    setGames([]);
    setLoading(true);
  }, [tournamentId]);

  usePolling((isCurrent) => {
    if (!verifiedTournamentId) {
      if (isCurrent()) setLoading(false);
      return;
    }
    api.public.get(`/public/tournaments/${verifiedTournamentId}/bracket`)
      .then((d) => {
        if (isCurrent()) setGames(d.games);
      })
      .catch(() => {})
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });
  }, [verifiedTournamentId]);

  const layout = useMemo(() => buildBracketLayout(games), [games]);

  return (
    <PublicLayout tournamentName={tournament?.name}>
      {loading ? (
        <div style={{ color: 'var(--color-text-subtle)', textAlign: 'center', padding: '32px 0' }}>Loading bracket&hellip;</div>
      ) : !layout ? (
        <div style={{ color: 'var(--color-text-subtle)', fontStyle: 'italic', textAlign: 'center', padding: '32px 0' }}>The playoff bracket hasn't been set yet.</div>
      ) : (
        <div style={{ overflowX: 'auto', paddingBottom: '16px' }}>
          <div style={{ width: 'fit-content', margin: '0 auto' }}>
            <div style={{ display: 'flex', gap: COL_GAP, marginLeft: PAD_LEFT, marginBottom: '12px' }}>
              {layout.rounds.map(round => (
                <RoundHeader key={round.name} name={round.name} />
              ))}
              {layout.champion && <RoundHeader name="Champion" />}
            </div>

            <div style={{ position: 'relative', width: layout.canvasW, height: layout.canvasH }}>
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none', overflow: 'visible' }}>
              {layout.connectors.map((c, i) => (
                <line key={i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="#CBD5E1" strokeWidth="2" />
              ))}
            </svg>

            {layout.cards.map(({ game, x, y }) => (
              <MatchCard key={game.id} game={game} style={{ left: x, top: y }} />
            ))}

            {layout.thirdPlaceRound && layout.thirdPlaceRound.games.map((game) => (
              <MatchCard key={game.id} game={game} style={{ left: layout.thirdPlaceCardX, top: layout.thirdPlaceCardY }} />
            ))}

            {layout.thirdPlaceRound && (
              <RoundHeader name={layout.thirdPlaceRound.name} style={{ position: 'absolute', left: layout.thirdPlaceCardX, top: layout.thirdPlaceCardY - 28 }} />
            )}

            {layout.championCard && (
              <ChampionCard game={layout.championCard.game} style={{ left: layout.championCard.x, top: layout.championCard.y }} />
            )}
          </div>
          </div>
        </div>
      )}
    </PublicLayout>
  );
}
