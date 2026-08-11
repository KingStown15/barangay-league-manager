import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useTournamentSelection } from '../utils/useTournamentSelection';
import TournamentPicker from '../components/TournamentPicker';
import Badge from '../components/ui/Badge';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCard } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { usePolling } from '../utils/usePolling';
import { getWinnerSide } from '../utils/gameResultStyles';
import { formatCompletedGames, getGameSideName } from '../utils/entryDisplay';

const CARD_W = 230;
const CARD_H = 124;
const GAP = 24;
const COL_GAP = 20;
const PAD_LEFT = 20;
const BOTTOM_PAD = 24;

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

  const champion = (finalGame && finalGame.status === 'completed' && finalGame.approved_at && getWinnerSide(finalGame))
    ? finalGame
    : null;

  const cards = [];
  const connectors = [];

  rounds.forEach((round, ri) => {
    round.games.forEach((game, gi) => {
      const factor = Math.pow(2, ri);
      const slotMid = gi * factor + (factor - 1) / 2;
      const x = PAD_LEFT + ri * (CARD_W + COL_GAP);
      const y = slotMid * (CARD_H + GAP);
      cards.push({ game, x, y, ri, gi });
    });
  });

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

  let thirdPlaceCardX = 0;
  let thirdPlaceCardY = 0;
  if (thirdPlaceRound) {
    thirdPlaceCardX = PAD_LEFT + finalsCol * (CARD_W + COL_GAP);
    const maxCardBottom = cards.reduce((m, c) => Math.max(m, c.y + CARD_H), 0);
    thirdPlaceCardY = maxCardBottom + GAP;
  }

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

  const totalCols = rounds.length + (champion ? 1 : 0);
  const canvasW = PAD_LEFT + totalCols * (CARD_W + COL_GAP) + PAD_LEFT;
  const lastCardBottom = cards.reduce((m, c) => Math.max(m, c.y + CARD_H), 0);
  const thirdBottom = thirdPlaceRound ? thirdPlaceCardY + CARD_H : 0;
  const canvasH = Math.max(lastCardBottom, thirdBottom) + BOTTOM_PAD;

  return { rounds, thirdPlaceRound, thirdPlaceCardX, thirdPlaceCardY, champion, cards, championCard, connectors, canvasW, canvasH };
}

function statusVariant(status, approvedAt) {
  if (status === 'ongoing') return 'live';
  if (status === 'completed') return approvedAt ? 'final' : 'needs-approval';
  if (status === 'forfeited') return 'danger';
  return 'default';
}

function statusLabel(status, approvedAt) {
  if (status === 'ongoing') return 'LIVE';
  if (status === 'completed') return approvedAt ? 'COMPLETED' : 'FULL TIME';
  if (status === 'forfeited') return 'FORFEIT';
  return status;
}

function MatchCard({ game, style }) {
  const winnerSide = getWinnerSide(game);
  const winnerA = winnerSide === 'A';
  const winnerB = winnerSide === 'B';
  const isLive = game.status === 'ongoing';
  const scoreA = isLive ? game.live_score_a : game.score_a;
  const scoreB = isLive ? game.live_score_b : game.score_b;
  const sv = statusVariant(game.status, game.approved_at);
  const sl = statusLabel(game.status, game.approved_at);
  const showBadge = game.status !== 'scheduled' && !(game.status === 'completed' && game.approved_at);
  const padT = showBadge ? 10 : 6;
  const sideAName = getGameSideName(game, 'a');
  const sideBName = getGameSideName(game, 'b');
  const breakdown = formatCompletedGames(game);

  return (
    <div className="card" style={{ position: 'absolute', width: CARD_W, height: CARD_H, padding: `${padT}px 14px`, display: 'flex', flexDirection: 'column', border: isLive ? '1px solid var(--color-accent)' : undefined, ...style }}>
      {showBadge && (
        <div style={{ marginBottom: '3px', flexShrink: 0 }}>
          <Badge variant={sv}>{sl}</Badge>
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '6px', minHeight: '22px' }}>
          <span title={sideAName} className="bracket-entry-name" style={{ color: winnerA ? '#16A34A' : (winnerSide ? '#EF4444' : 'var(--color-text)'), fontWeight: winnerA ? 700 : (winnerSide ? 500 : 500) }}>{sideAName}</span>
          {scoreA !== null && scoreA !== undefined ? (
            <span className="scoreboard-digits" style={{ fontSize: '13px', padding: '3px 9px', display: 'inline-flex', alignItems: 'center' }}>{scoreA}</span>
          ) : (
            <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', fontWeight: 600 }}>&mdash;</span>
          )}
        </div>
        <div style={{ borderTop: '1px dashed var(--color-border)', margin: '5px 0' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '6px', minHeight: '22px' }}>
          <span title={sideBName} className="bracket-entry-name" style={{ color: winnerB ? '#16A34A' : (winnerSide ? '#EF4444' : 'var(--color-text)'), fontWeight: winnerB ? 700 : (winnerSide ? 500 : 500) }}>{sideBName}</span>
          {scoreB !== null && scoreB !== undefined ? (
            <span className="scoreboard-digits" style={{ fontSize: '13px', padding: '3px 9px', display: 'inline-flex', alignItems: 'center' }}>{scoreB}</span>
          ) : (
            <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', fontWeight: 600 }}>&mdash;</span>
          )}
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
    <div className="card" style={{ position: 'absolute', width: CARD_W, height: CARD_H, padding: '10px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '2px', border: '2px solid var(--color-primary)', ...style }}>
      <div style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--color-primary)' }}>Champion</div>
      <div style={{ fontSize: '17px', fontWeight: 900, letterSpacing: '-0.02em', color: 'var(--color-text)', textAlign: 'center', lineHeight: 1.2 }}>{winnerName}</div>
      {game.score_a !== null && game.score_a !== undefined && (
        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-muted)' }}>{game.score_a} &ndash; {game.score_b}</div>
      )}
    </div>
  );
}

function RoundHeader({ name, style }) {
  return (
    <div style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--color-primary)', textAlign: 'center', width: CARD_W, ...style }}>
      {name}
    </div>
  );
}

export default function Bracket() {
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const { tournaments, tournamentId, setTournamentId } = useTournamentSelection();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fromUrl = searchParams.get('tournament');
    if (fromUrl) setTournamentId(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setGames([]);
    setLoading(true);
  }, [tournamentId]);

  usePolling((isCurrent) => {
    if (!tournamentId) {
      if (isCurrent()) setLoading(false);
      return;
    }
    api.get(`/bracket?tournament_id=${tournamentId}`)
      .then((d) => {
        if (isCurrent()) setGames(d.games);
      })
      .catch((err) => {
        if (isCurrent()) toast.error(err.message);
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });
  }, [tournamentId]);

  const layout = useMemo(() => buildBracketLayout(games), [games]);

  return (
    <div>
      <PageHeader title="Bracket" />
      <TournamentPicker tournaments={tournaments} tournamentId={tournamentId} onChange={setTournamentId} />
      {loading ? <SkeletonCard lines={4} /> : (
        !layout ? (
          <div className="card card-padding" style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', textAlign: 'center' }}>
            The playoff bracket hasn't been generated yet.
          </div>
        ) : (
          <div className="card card-padding" style={{ overflowX: 'auto', minHeight: layout.canvasH + 20 }}>
            <div style={{ width: 'fit-content', margin: '0 auto' }}>
              <div style={{ display: 'flex', gap: COL_GAP, marginLeft: PAD_LEFT, marginBottom: '10px' }}>
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
        )
      )}
    </div>
  );
}
