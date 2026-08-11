import { useEffect, useRef, useState } from 'react';
import { Play, Flag, Trophy, ArrowLeft, List, Swords, Clock, Timer, Smartphone } from 'lucide-react';
import { useBasketballLiveClock } from '../utils/useBasketballLiveClock';
import { api } from '../api/client';
import ScoreStepper from '../components/ScoreStepper';
import BasketballClock from '../components/BasketballClock';
import PickleballScorer from '../components/PickleballScorer';
import VolleyballScorer from '../components/VolleyballScorer';
import ModalBase from '../components/ModalBase';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import { SkeletonList } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { formatEntryLabel, getGameSideName, hasGameSides } from '../utils/entryDisplay';
import { applyLiveGameOverlay } from '../utils/liveGameState';
import { buildScorerActionRequest, executeScorerActionRequest, SCORER_ACTIONS } from '../utils/scorerActions';
import { useLiveScoreStream } from '../utils/useLiveScoreStream';
import { isAdminRole } from '../utils/roles';
import { getVolleyballFinalValidation } from '../utils/volleyballRules';

function formatRoundLabel(label, status) {
  if (!label) return null;
  if (status === 'ongoing') {
    const u = label.toUpperCase();
    if (u === 'FINAL' || u === 'CHAMPIONSHIP' || u === 'FINALS') return 'Finals Round';
    if (u === 'SEMIFINALS' || u === 'SEMI-FINALS') return 'Semi-Finals';
    if (u === 'QUARTERFINALS' || u === 'QUARTER-FINALS') return 'Quarter-Finals';
  }
  return label;
}

function getFinalScoreValidation(sport, scoreA, scoreB, roundLabel) {
  if (!Number.isSafeInteger(scoreA) || !Number.isSafeInteger(scoreB) || scoreA < 0 || scoreB < 0 || scoreA > 999 || scoreB > 999) {
    return 'Scores must be whole numbers between 0 and 999.';
  }
  if (scoreA === scoreB) {
    return sport === 'basketball'
      ? 'Basketball final scores cannot be tied. Complete overtime before submitting.'
      : 'Volleyball final set scores cannot be tied.';
  }
  if (sport === 'volleyball') {
    return getVolleyballFinalValidation(roundLabel, scoreA, scoreB);
  }
  return '';
}

export default function Scorer() {
  const { user } = useAuth();
  const toast = useToast();
  const [tournament, setTournament] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [games, setGames] = useState([]);
  const [activeGame, setActiveGame] = useState(null);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [prevScoreA, setPrevScoreA] = useState(null);
  const [prevScoreB, setPrevScoreB] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [finalSubmitError, setFinalSubmitError] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [scoreBusy, setScoreBusy] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const saveTimer = useRef(null);
  const scoreLockRef = useRef(false);
  const submitLockRef = useRef(false);
  const finalCancelRef = useRef(null);
  const tournamentSelectRef = useRef(null);
  const focusGameListAfterSubmitRef = useRef(false);
  const SCORER_TOURNAMENT_KEY = 'blm_scorer_tournament_id';
  const clockDisplay = useBasketballLiveClock(activeGame);
  const { liveScores, reconcilePolledGames } = useLiveScoreStream(tournament?.id);

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < 768);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  function loadGames(tournamentId) {
    const requestStartedAt = Date.now();
    api.get(`/games?tournament_id=${tournamentId}`)
      .then((res) => {
        const list = res.games || [];
        reconcilePolledGames(list, requestStartedAt);
        setGames(list);
        const refreshed = activeGame && list.find((game) => game.id === activeGame.id);
        if (refreshed) {
          setActiveGame((previous) => previous?.id === refreshed.id
            ? applyLiveGameOverlay(previous, refreshed)
            : previous);
          if (refreshed.live_score_a !== null && refreshed.live_score_a !== undefined && refreshed.live_score_a !== scoreA) {
            setScoreA(refreshed.live_score_a);
            setPrevScoreA(null);
          }
          if (refreshed.live_score_b !== null && refreshed.live_score_b !== undefined && refreshed.live_score_b !== scoreB) {
            setScoreB(refreshed.live_score_b);
            setPrevScoreB(null);
          }
        }
      })
      .catch((err) => { if (!loading) setError(err.message); })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!activeGame?.id) return;
    const overlay = liveScores[activeGame.id];
    if (!overlay) return;
    const updated = { id: activeGame.id, ...overlay };
    setActiveGame((previous) => previous?.id === activeGame.id
      ? applyLiveGameOverlay(previous, overlay)
      : previous);
    setGames((previous) => previous.map((game) => game.id === activeGame.id
      ? applyLiveGameOverlay(game, overlay)
      : game));
    if (updated.live_score_a !== null && updated.live_score_a !== undefined && updated.live_score_a !== scoreA) {
      setScoreA(updated.live_score_a);
      setPrevScoreA(null);
    }
    if (updated.live_score_b !== null && updated.live_score_b !== undefined && updated.live_score_b !== scoreB) {
      setScoreB(updated.live_score_b);
      setPrevScoreB(null);
    }
  }, [activeGame?.id, liveScores, scoreA, scoreB]);

  function handleClockUpdate(updatedGame) {
    if (!updatedGame) return;
    setActiveGame(prev => ({
      ...prev,
      ...updatedGame,
    }));
    setGames(prev => prev.map(g => g.id === updatedGame.id ? updatedGame : g));
  }

  function handleVolleyballUpdate(updatedGame) {
    if (!updatedGame) return;
    setActiveGame(prev => ({ ...prev, ...updatedGame }));
    setScoreA(updatedGame.volleyball?.sets_won_a ?? updatedGame.live_score_a ?? 0);
    setScoreB(updatedGame.volleyball?.sets_won_b ?? updatedGame.live_score_b ?? 0);
    setGames(prev => prev.map(g => g.id === updatedGame.id ? updatedGame : g));
  }

  function selectTournament(t) {
    setActiveGame(null);
    setShowFinalConfirm(false);
    setTournament(t);
    setGames([]);
    setLoading(true);
    setError('');
    localStorage.setItem(SCORER_TOURNAMENT_KEY, String(t.id));
    loadGames(t.id);
  }

  useEffect(() => {
    setLoading(true);
    api.get('/tournaments').then((d) => {
      const eligible = (d.tournaments || []).filter(t => t.status !== 'archived');
      setTournaments(eligible);

      const saved = localStorage.getItem(SCORER_TOURNAMENT_KEY);
      let selected = null;

      if (saved) selected = eligible.find(t => String(t.id) === saved);
      if (!selected) selected = eligible.find(t => t.status === 'active');
      if (!selected) selected = eligible[0] || null;

      if (selected) {
        setTournament(selected);
        loadGames(selected.id);
      } else {
        setLoading(false);
      }
    }).catch((err) => {
      setError(err.message);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (activeGame || !focusGameListAfterSubmitRef.current) return undefined;
    const frame = requestAnimationFrame(() => {
      tournamentSelectRef.current?.focus();
      focusGameListAfterSubmitRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeGame]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  function openGame(game) {
    setActiveGame(game);
    setScoreA(game.live_score_a ?? game.score_a ?? 0);
    setScoreB(game.live_score_b ?? game.score_b ?? 0);
    setPrevScoreA(null);
    setPrevScoreB(null);
    scoreLockRef.current = false;
    setScoreBusy(false);
    setSaveState('idle');
    setRemarks(game.remarks || '');
    setConfirmForfeit(false);
    setShowFinalConfirm(false);
    setFinalSubmitError('');
    setError('');
  }

  async function saveBasketballScore(side, nextScore, undo = false) {
    if (scoreLockRef.current || !activeGame || activeGame.status !== 'ongoing' || tournament?.sport !== 'basketball') return;
    const expectedA = scoreA;
    const expectedB = scoreB;
    const current = side === 'A' ? expectedA : expectedB;
    const delta = nextScore - current;
    const action = undo
      ? (side === 'A' ? SCORER_ACTIONS.SIDE_A_UNDO : SCORER_ACTIONS.SIDE_B_UNDO)
      : ({
          'A:1': SCORER_ACTIONS.SIDE_A_ADD_1,
          'A:2': SCORER_ACTIONS.SIDE_A_ADD_2,
          'A:3': SCORER_ACTIONS.SIDE_A_ADD_3,
          'A:-1': SCORER_ACTIONS.SIDE_A_SUBTRACT_1,
          'B:1': SCORER_ACTIONS.SIDE_B_ADD_1,
          'B:2': SCORER_ACTIONS.SIDE_B_ADD_2,
          'B:3': SCORER_ACTIONS.SIDE_B_ADD_3,
          'B:-1': SCORER_ACTIONS.SIDE_B_SUBTRACT_1,
        })[`${side}:${delta}`];
    if (!action) return;

    scoreLockRef.current = true;
    setScoreBusy(true);
    setSaveState('saving');
    setError('');
    try {
      const specification = buildScorerActionRequest(action, {
        game: activeGame,
        sport: 'basketball',
        scoreA: expectedA,
        scoreB: expectedB,
        previousScoreA: prevScoreA,
        previousScoreB: prevScoreB,
      });
      if (!specification.ok) throw new Error(specification.message);
      const accepted = await executeScorerActionRequest(specification);
      const updated = accepted.game;
      setScoreA(updated.live_score_a);
      setScoreB(updated.live_score_b);
      if (side === 'A') setPrevScoreA(undo ? null : expectedA);
      if (side === 'B') setPrevScoreB(undo ? null : expectedB);
      setActiveGame((previous) => previous?.id === updated.id ? { ...previous, ...updated } : previous);
      setGames((previous) => previous.map((game) => game.id === updated.id ? updated : game));
      setSaveState('synced');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveState('idle'), 2000);
    } catch (err) {
      setSaveState('idle');
      setError(err.message);
      if (err.status === 409) await refreshActiveGameAfterConflict(activeGame.id);
    } finally {
      scoreLockRef.current = false;
      setScoreBusy(false);
    }
  }

  async function markOngoing(game) {
    try {
      const response = await api.patch(`/games/${game.id}/status`, { status: 'ongoing' });
      toast.success('Game marked ongoing — live score is now visible on the public view.');
      openGame(response.game || { ...game, status: 'ongoing', live_score_a: 0, live_score_b: 0 });
      if (tournament) loadGames(tournament.id);
    } catch (err) {
      setError(err.message);
    }
  }

  function openFinalConfirm() {
    if (!activeGame || activeGame.status !== 'ongoing' || !activeGame.team_a_id || !activeGame.team_b_id) return;
    if (submitting || saveState === 'saving') return;
    setFinalSubmitError('');
    setShowFinalConfirm(true);
  }

  function closeFinalConfirm() {
    if (submitting) return;
    setShowFinalConfirm(false);
    setFinalSubmitError('');
  }

  async function refreshActiveGameAfterConflict(gameId) {
    try {
      const latest = await api.get(`/games/${gameId}`);
      if (latest.game) {
        setActiveGame(latest.game);
        setScoreA(latest.game.live_score_a ?? latest.game.score_a ?? 0);
        setScoreB(latest.game.live_score_b ?? latest.game.score_b ?? 0);
        setPrevScoreA(null);
        setPrevScoreB(null);
      }
    } catch {}
    if (tournament) loadGames(tournament.id);
  }

  async function submitFinal() {
    if (submitLockRef.current || !activeGame) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setFinalSubmitError('');
    const gameId = activeGame.id;
    try {
      await api.post(`/games/${gameId}/submit`, {
        score_a: scoreA,
        score_b: scoreB,
        expected_live_score_a: scoreA,
        expected_live_score_b: scoreB,
        ...(tournament?.sport === 'volleyball' ? {
          periods: activeGame.volleyball?.completed_sets?.map((set) => ({
            team_a_score: set.team_a_score,
            team_b_score: set.team_b_score,
          })) || [],
        } : {}),
        remarks,
      });
      toast.success(isAdminRole(user.role) ? 'Final score saved and approved.' : 'Score submitted — pending admin approval.');
      setShowFinalConfirm(false);
      focusGameListAfterSubmitRef.current = true;
      setActiveGame(null);
      if (tournament) loadGames(tournament.id);
    } catch (err) {
      setFinalSubmitError(err.message);
      if (err.status === 409) await refreshActiveGameAfterConflict(gameId);
    } finally {
      setSubmitting(false);
      submitLockRef.current = false;
    }
  }

  async function submitForfeit(teamId) {
    if (submitLockRef.current || !activeGame || saveState === 'saving') return;
    submitLockRef.current = true;
    setSubmitting(true);
    setError('');
    const gameId = activeGame.id;
    try {
      await api.post(`/games/${gameId}/submit`, {
        forfeit_team_id: teamId,
        expected_live_score_a: scoreA,
        expected_live_score_b: scoreB,
        remarks,
      });
      toast.success(isAdminRole(user.role) ? 'Forfeit recorded and approved.' : 'Forfeit submitted — pending admin approval.');
      focusGameListAfterSubmitRef.current = true;
      setActiveGame(null);
      if (tournament) loadGames(tournament.id);
    } catch (err) {
      setError(err.message);
      if (err.status === 409) await refreshActiveGameAfterConflict(gameId);
    } finally {
      setSubmitting(false);
      submitLockRef.current = false;
    }
  }

  if (loading) {
    return <SkeletonList count={3} />;
  }

  if (!tournament) {
    return (
      <EmptyState
        icon={Swords}
        title="No eligible tournaments found"
        description="Ask an admin to create and set up a tournament with games ready for scoring."
      />
    );
  }

  if (activeGame) {
    if (tournament.sport === 'pickleball') {
      return (
        <PickleballScorer
          initialGame={activeGame}
          tournament={tournament}
          user={user}
          onBack={() => setActiveGame(null)}
          onChanged={() => loadGames(tournament.id)}
        />
      );
    }
    const isOngoing = activeGame.status === 'ongoing';
    const sport = tournament.sport || 'basketball';
    const isBBall = sport === 'basketball';
    const finalValidation = getFinalScoreValidation(sport, scoreA, scoreB, activeGame.round_label);
    const winnerName = scoreA > scoreB
      ? (activeGame.team_a_name || 'Team A')
      : (activeGame.team_b_name || 'Team B');

    return (
      <div className="scorer-container" style={{ paddingTop: isBBall && isOngoing && clockDisplay ? '16px' : '20px' }}>
        {isBBall && isOngoing && clockDisplay && (
          <div className="sticky-mobile-header">
            <div className="sticky-score-row">
              <span className="sticky-team-name">{activeGame.team_a_name || 'Team A'}</span>
              <span className="sticky-score">{scoreA}</span>
              <span className="sticky-vs">-</span>
              <span className="sticky-score">{scoreB}</span>
              <span className="sticky-team-name">{activeGame.team_b_name || 'Team B'}</span>
            </div>
            <div className="sticky-clock-row">
              <span className="sticky-period-badge">{clockDisplay.period}</span>
              <Clock size={14} strokeWidth={2} />
              <span className="sticky-gameclock">{clockDisplay.gameClock}</span>
              {clockDisplay.shotClock !== '--' && (
                <>
                  <Timer size={14} strokeWidth={2} />
                  <span className="sticky-shotclock" style={{ color: clockDisplay.shotExpired ? 'var(--color-danger, #DC2626)' : undefined }}>
                    {clockDisplay.shotClock}{clockDisplay.shotExpired ? ' EXPIRED' : ''}
                  </span>
                </>
              )}
              {saveState === 'saving' ? <span className="sticky-save-msg saving" /> : saveState === 'synced' ? <span className="sticky-save-msg synced" /> : null}
            </div>
          </div>
        )}

        <div className="scorer-active-toolbar">
          <button className="scorer-back-link" onClick={() => setActiveGame(null)}>
            <ArrowLeft size={14} strokeWidth={2.5} /> Games
          </button>
          <a className="btn-secondary text-sm" href={`/scorer-console/${activeGame.id}`} target="_blank" rel="noreferrer">
            Open Scorer Console
          </a>
        </div>

        <div className="game-info-card">
          {activeGame.round_label && (
            <div className="game-phase">{formatRoundLabel(activeGame.round_label, activeGame.status)}</div>
          )}
          {isOngoing ? (
            <div className="game-status-badge live">LIVE</div>
          ) : (
            <div className="game-status-badge">{activeGame.status}</div>
          )}
          <div className="game-matchup">{activeGame.team_a_name || 'Team A'} vs {activeGame.team_b_name || 'Team B'}</div>
          {isOngoing && (
            <div className="game-helper-text">Live score is visible on the public view as you tap. {saveState === 'saving' ? <span style={{ color: 'var(--color-text-subtle)' }}>Saving...</span> : saveState === 'synced' ? <span style={{ color: 'var(--color-success)' }}>Synced</span> : ''}</div>
            )}
        </div>

        {activeGame.status === 'scheduled' && (
          <div className="scorer-form-section">
            {!activeGame.team_a_id || !activeGame.team_b_id ? (
              <div style={{ textAlign: 'center', padding: '16px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                {!activeGame.team_a_id && !activeGame.team_b_id
                  ? 'Awaiting qualifiers'
                  : 'Awaiting opponent'}
              </div>
            ) : !activeGame.scheduled_at ? (
              <div>
                <Button className="w-full" disabled style={{ opacity: 0.5 }}>
                  <Play size={18} strokeWidth={2.5} /> Start Game (Mark Ongoing)
                </Button>
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', textAlign: 'center', marginTop: '6px' }}>
                  Schedule date/time required before starting.
                </div>
              </div>
            ) : (
              <Button className="w-full" onClick={() => markOngoing(activeGame)}>
                <Play size={18} strokeWidth={2.5} /> Start Game (Mark Ongoing)
              </Button>
            )}
          </div>
        )}

        {sport === 'basketball' && activeGame.status === 'scheduled' && (
          <div className="scorer-form-section">
            <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', textAlign: 'center', fontStyle: 'italic', padding: '12px' }}>
              Start the game first to enable clock controls.
            </div>
          </div>
        )}
        {isBBall && isOngoing && (
          isMobile ? (
            <BasketballClock
              game={activeGame}
              onGameUpdate={handleClockUpdate}
              loadGames={loadGames}
              toast={toast}
              compact
            />
          ) : (
            <BasketballClock
              game={activeGame}
              onGameUpdate={handleClockUpdate}
              loadGames={loadGames}
              toast={toast}
            />
          )
        )}
        {sport === 'volleyball' && isOngoing && (
          <VolleyballScorer game={activeGame} onGameUpdate={handleVolleyballUpdate} toast={toast} />
        )}
        {isOngoing && sport === 'basketball' && (
          <div className="scorer-team-grid">
            <ScoreStepper
              label={activeGame.team_a_name || 'Team A'}
              value={scoreA}
              onChange={(nextScore) => saveBasketballScore('A', nextScore)}
              onUndo={() => saveBasketballScore('A', prevScoreA, true)}
              previousValue={prevScoreA}
              sport={sport}
              disabled={scoreBusy}
            />
            <ScoreStepper
              label={activeGame.team_b_name || 'Team B'}
              value={scoreB}
              onChange={(nextScore) => saveBasketballScore('B', nextScore)}
              onUndo={() => saveBasketballScore('B', prevScoreB, true)}
              previousValue={prevScoreB}
              sport={sport}
              disabled={scoreBusy}
            />
          </div>
        )}

        <div className="scorer-form-section">
          <div className="scorer-remarks-card">
            <label style={{ fontSize: '13px', fontWeight: 700, color: '#64748B', display: 'block', marginBottom: '6px' }}>Remarks (optional)</label>
            <div className="scorer-remarks">
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>
        </div>

        {error && <div className="scorer-form-section"><div style={{ color: 'var(--color-danger)', fontSize: '14px' }}>{error}</div></div>}

        {isOngoing && (
          <div className="scorer-form-section">
            <div className="scorer-actions-card">
              <div className="submit-final-wrap">
                <Button
                  className="w-full"
                  disabled={submitting || saveState === 'saving'}
                  onClick={openFinalConfirm}
                  style={{ minHeight: '48px', borderRadius: '10px', fontWeight: 900 }}
                >
                  <Trophy size={18} strokeWidth={2.5} />
                  {saveState === 'saving' ? 'Syncing Score\u2026' : 'Review Final Score'}
                </Button>
              </div>

              <div className="mt-4">
                {!confirmForfeit ? (
                  <button
                    type="button"
                    className="btn-ghost text-sm w-full text-center"
                    style={{ color: 'var(--color-danger)' }}
                    disabled={submitting || saveState === 'saving'}
                    onClick={() => setConfirmForfeit(true)}
                  >
                    <Flag size={14} strokeWidth={2} /> Record a forfeit instead
                  </button>
                ) : (
                  <div className="scorer-team-card space-y-2" style={{ padding: '16px' }}>
                    <div className="text-sm" style={{ color: 'var(--color-text-muted)', textAlign: 'center' }}>Which team is forfeiting?</div>
                    <Button variant="danger" className="w-full" disabled={submitting || saveState === 'saving'} onClick={() => submitForfeit(activeGame.team_a_id)}>
                      {activeGame.team_a_name || 'Team A'} forfeits
                    </Button>
                    <Button variant="danger" className="w-full" disabled={submitting || saveState === 'saving'} onClick={() => submitForfeit(activeGame.team_b_id)}>
                      {activeGame.team_b_name || 'Team B'} forfeits
                    </Button>
                    <button type="button" className="btn-ghost text-sm w-full text-center" disabled={submitting} onClick={() => setConfirmForfeit(false)}>Cancel</button>
                  </div>
                )}
              </div>
            </div>

            <p className="text-xs text-center mt-4" style={{ color: 'var(--color-text-muted)' }}>
              {isAdminRole(user.role)
                ? 'Admin submissions are approved immediately and update the official result.'
                : 'Scorer submissions wait for admin approval before updating public standings.'}
            </p>
          </div>
        )}

        <ModalBase
          isOpen={showFinalConfirm}
          onClose={closeFinalConfirm}
          title="Submit Final Score?"
          subtitle={isAdminRole(user.role)
            ? 'Review carefully. This admin submission is approved immediately.'
            : 'Review carefully. This sends the result to an admin for approval.'}
          size="sm"
          closeDisabled={submitting}
          initialFocusRef={finalCancelRef}
          footer={
            <>
              <button
                ref={finalCancelRef}
                type="button"
                className="btn-secondary"
                style={{ minHeight: '48px' }}
                disabled={submitting}
                onClick={closeFinalConfirm}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                style={{ minHeight: '48px' }}
                disabled={submitting || saveState === 'saving' || Boolean(finalValidation) || activeGame.status !== 'ongoing'}
                onClick={submitFinal}
              >
                {submitting ? 'Submitting\u2026' : 'Confirm Final Score'}
              </button>
            </>
          }
        >
          <div className="final-submit-summary">
            <div className="final-submit-meta">
              <span>{tournament.name}</span>
              <span>{sport}</span>
              {activeGame.round_label && <span>{formatRoundLabel(activeGame.round_label, activeGame.status)}</span>}
            </div>
            <div className="final-submit-score-label">Final {sport === 'volleyball' ? 'sets' : 'points'}</div>
            <div className="final-submit-score-grid">
              <div className="final-submit-team">
                <span>{activeGame.team_a_name || 'Team A'}</span>
                <strong>{scoreA}</strong>
              </div>
              <span className="final-submit-score-separator">–</span>
              <div className="final-submit-team">
                <span>{activeGame.team_b_name || 'Team B'}</span>
                <strong>{scoreB}</strong>
              </div>
            </div>
            {finalValidation ? (
              <div className="final-submit-validation" role="alert">{finalValidation}</div>
            ) : (
              <div className="final-submit-winner"><span>Winner</span><strong>{winnerName}</strong></div>
            )}
            <div className="final-submit-consequence">
              {isAdminRole(user.role)
                ? 'This will finalize and approve the result immediately. Standings, public results, and bracket progression may update.'
                : 'This will end the live game, stop the clock, and send the result for admin approval. You cannot edit it unless an admin rejects and reopens it.'}
            </div>
            <dl className="final-submit-details">
              {isBBall && clockDisplay?.text && <><dt>Clock</dt><dd>{clockDisplay.text}</dd></>}
              <dt>Remarks</dt><dd>{remarks.trim() || 'None'}</dd>
            </dl>
            {finalSubmitError && <div className="final-submit-error" role="alert">{finalSubmitError}</div>}
          </div>
        </ModalBase>
      </div>
    );
  }

  const relevant = showAll ? games : games.filter((g) => ['scheduled', 'ongoing'].includes(g.status));

  return (
    <div className="scorer-container">
      <div className="scorer-form-section" style={{ marginTop: 0, marginBottom: '16px' }}>
        <div className="scorer-remarks-card" style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-text)' }}>{tournament.name}</div>
              <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginTop: '2px' }}>{tournament.sport} &middot; {tournament.status}</div>
              {tournament.sport === 'pickleball' && <div className="entry-context-line">{formatEntryLabel(tournament.division)} · {formatEntryLabel(tournament.competition_format)}</div>}
            </div>
            <div style={{ minWidth: 0, width: 'min(100%, 260px)', flexShrink: 1 }}>
              <label className="label" style={{ marginBottom: '2px' }}>Switch Tournament</label>
              <select
                ref={tournamentSelectRef}
                className="input"
                value={tournament.id}
                onChange={(e) => {
                  const t = tournaments.find(t2 => String(t2.id) === String(e.target.value));
                  if (t) selectTournament(t);
                }}
              >
                {tournaments.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.status})</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {error && <div style={{ color: 'var(--color-danger)', fontSize: '14px' }} className="mb-3">{error}</div>}

      <div className="space-y-3">
        {relevant.map((game) => (
          <div key={game.id} className="card scorer-game-row">
            <button type="button" className="scorer-game-select" onClick={() => openGame(game)}>
              <div className="flex items-center justify-between mb-1">
                {game.round_label && <span className="text-xs uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>{game.round_label}</span>}
                <Badge variant={game.status}>{game.status}</Badge>
              </div>
              {hasGameSides(game) ? (
                <div className="font-semibold text-lg" style={{ color: 'var(--color-text)' }}>
                  {getGameSideName(game, 'a')} <span style={{ color: 'var(--color-text-muted)' }}>vs</span> {getGameSideName(game, 'b')}
                </div>
              ) : (
                <div style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                  {!(game.side_a_entry_id || game.team_a_id) && !(game.side_b_entry_id || game.team_b_id) ? 'Awaiting qualifiers' : 'Awaiting opponent'}
                </div>
              )}
              {(game.score_a !== null && game.score_a !== undefined && game.score_b !== null && game.score_b !== undefined) && (
                <div className="game-score-cluster">
                  <span className="game-score-chip">{game.score_a}</span>
                  <span className="game-score-separator">-</span>
                  <span className="game-score-chip">{game.score_b}</span>
                </div>
              )}
              {(game.side_a_entry_id || game.team_a_id) && (game.side_b_entry_id || game.team_b_id) && game.status === 'ongoing' && tournament.sport !== 'pickleball' && (game.score_a === null || game.score_a === undefined || game.score_b === null || game.score_b === undefined) && (
                <div className="flex items-center gap-2 mt-2">
                  <div className="game-score-cluster">
                    <span className="game-score-chip live">{game.live_score_a ?? 0}</span>
                    <span className="game-score-separator">-</span>
                    <span className="game-score-chip live">{game.live_score_b ?? 0}</span>
                  </div>
                  <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--color-warning)' }}>Live</span>
                </div>
              )}
            </button>
            {game.status === 'ongoing' && hasGameSides(game) && (
              <a className="scorer-console-launch" href={`/scorer-console/${game.id}`} target="_blank" rel="noreferrer">
                <Smartphone size={17} strokeWidth={2.3} /> Open Console
              </a>
            )}
          </div>
        ))}
        {relevant.length === 0 && (
          <EmptyState icon={Trophy} title={showAll ? 'No games found' : 'No scheduled or ongoing games'} description={showAll ? 'This tournament has no games yet.' : 'Switch to a different tournament or enable "Show all games" below.'} compact />
        )}
      </div>

      <button className="btn-ghost text-sm mt-4 w-full text-center" onClick={() => setShowAll((s) => !s)}>
        <List size={14} strokeWidth={2} /> {showAll ? 'Show only scheduled & ongoing' : 'Show all games'}
      </button>
    </div>
  );
}
