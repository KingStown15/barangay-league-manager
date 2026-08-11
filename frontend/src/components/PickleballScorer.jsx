import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Play, RefreshCw, RotateCcw, Trophy } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from './Toast';
import ModalBase from './ModalBase';
import Button from './ui/Button';
import { getGameSideName } from '../utils/entryDisplay';
import { getPickleballRuleSummary } from '../utils/pickleballConsoleState';
import { isAdminRole } from '../utils/roles';
import { buildScorerActionRequest, executeScorerActionRequest, SCORER_ACTIONS } from '../utils/scorerActions';

function actionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `pickleball-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatLabel(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function PickleballScorer({ initialGame, tournament, user, onBack, onChanged }) {
  const toast = useToast();
  const [game, setGame] = useState(initialGame);
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remarks, setRemarks] = useState(initialGame.remarks || '');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const lockRef = useRef(false);
  const cancelRef = useRef(null);

  const sideAName = getGameSideName(game, 'a', 'Entry A');
  const sideBName = getGameSideName(game, 'b', 'Entry B');
  const state = match?.state;
  const completedGames = match?.completed_games || [];
  const rules = state?.rules || tournament.sport_config || {};
  const winnerName = state && state.side_a_games_won !== state.side_b_games_won
    ? (state.side_a_games_won > state.side_b_games_won ? sideAName : sideBName)
    : null;

  async function load() {
    setLoading(true);
    try {
      const response = await api.get(`/games/${initialGame.id}`);
      setGame(response.game);
      setMatch(response.pickleball);
      setRemarks(response.game.remarks || '');
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [initialGame.id]);

  async function startMatch() {
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/games/${game.id}/status`, { status: 'ongoing' });
      await load();
      toast.success('Pickleball match started.');
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      lockRef.current = false;
    }
  }

  async function sendAction(action, payload = {}) {
    if (lockRef.current || !state) return;
    lockRef.current = true;
    setBusy(true);
    setError('');
    try {
      const scorerAction = action === 'award_point'
        ? (payload.side === 'A' ? SCORER_ACTIONS.SIDE_A_ADD_1 : SCORER_ACTIONS.SIDE_B_ADD_1)
        : action === 'remove_point'
          ? (payload.side === 'A' ? SCORER_ACTIONS.SIDE_A_SUBTRACT_1 : SCORER_ACTIONS.SIDE_B_SUBTRACT_1)
          : ({
              undo: SCORER_ACTIONS.PICKLEBALL_UNDO_LAST_ACTION,
              change_service: SCORER_ACTIONS.PICKLEBALL_CHANGE_SERVICE,
              start_next_game: SCORER_ACTIONS.PICKLEBALL_START_NEXT_GAME,
              set_server: payload.server_number === 1
                ? SCORER_ACTIONS.PICKLEBALL_SET_SERVER_1
                : SCORER_ACTIONS.PICKLEBALL_SET_SERVER_2,
            })[action];
      const specification = buildScorerActionRequest(scorerAction, {
        game,
        sport: 'pickleball',
        pickleballState: state,
        actionId: actionId(),
      });
      if (!specification.ok) throw new Error(specification.message);
      const accepted = await executeScorerActionRequest(specification);
      setMatch(accepted.pickleball);
      onChanged?.();
    } catch (err) {
      setError(err.message);
      if (err.status === 409) await load();
    } finally {
      setBusy(false);
      lockRef.current = false;
    }
  }

  async function submitFinal() {
    if (lockRef.current || !state || state.match_state !== 'ready_to_submit') return;
    lockRef.current = true;
    setBusy(true);
    setError('');
    try {
      await api.post(`/games/${game.id}/submit`, {
        expected_match_version: state.version,
        remarks,
      });
      setConfirmOpen(false);
      toast.success(isAdminRole(user.role)
        ? 'Pickleball result saved and approved.'
        : 'Pickleball result submitted — pending admin approval.');
      onChanged?.({ completed: true });
      onBack();
    } catch (err) {
      setError(err.message);
      if (err.status === 409) {
        setConfirmOpen(false);
        await load();
      }
    } finally {
      setBusy(false);
      lockRef.current = false;
    }
  }

  if (loading) {
    return <div className="pickleball-scorer-loading">Loading Pickleball match…</div>;
  }

  const hasSides = Boolean(game.side_a_entry_id && game.side_b_entry_id);
  const canScore = game.status === 'ongoing' && state?.match_state === 'in_progress';
  const betweenGames = game.status === 'ongoing' && state?.match_state === 'between_games';
  const readyToSubmit = game.status === 'ongoing' && state?.match_state === 'ready_to_submit';
  const showService = Boolean(rules.track_service);
  const showServer = rules.competition_format === 'doubles' && rules.track_server_number;

  return (
    <div className="pickleball-scorer">
      {state && game.status === 'ongoing' && (
        <div className="pickleball-sticky-score" aria-label={`${sideAName} ${state.side_a_points}, ${sideBName} ${state.side_b_points}`}>
          <span>{sideAName}</span><strong>{state.side_a_points}</strong>
          <small>Game {state.current_game_number}</small>
          <strong>{state.side_b_points}</strong><span>{sideBName}</span>
        </div>
      )}

      <div className="scorer-active-toolbar">
        <button type="button" className="scorer-back-link" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={2.5} /> Games
        </button>
        <a className="btn-secondary text-sm" href={`/scorer-console/${game.id}`} target="_blank" rel="noreferrer">
          Open Scorer Console
        </a>
      </div>

      <section className="pickleball-match-header">
        <div className="pickleball-meta-row">
          <span>{tournament.name}</span>
          <span>{formatLabel(tournament.division)}</span>
          <span>{formatLabel(tournament.competition_format)}</span>
          {game.round_label && <span>{game.round_label}</span>}
        </div>
        <div className={`game-status-badge ${game.status === 'ongoing' ? 'live' : ''}`}>{game.status}</div>
        <h1>{sideAName} <small>vs</small> {sideBName}</h1>
        {state && <p>Game {state.current_game_number} · {getPickleballRuleSummary(state, rules)}</p>}
      </section>

      {game.status === 'scheduled' && (
        <section className="pickleball-start-card">
          {!hasSides ? (
            <p>Both bracket competitors must be known before this match can start.</p>
          ) : !game.scheduled_at ? (
            <p>Schedule date and time are required before starting.</p>
          ) : (
            <Button className="w-full" size="lg" disabled={busy} onClick={startMatch}>
              <Play size={19} /> {busy ? 'Starting…' : 'Start Pickleball Match'}
            </Button>
          )}
        </section>
      )}

      {state && (
        <>
          <section className="pickleball-score-grid">
            {[
              { side: 'A', name: sideAName, points: state.side_a_points, gamesWon: state.side_a_games_won },
              { side: 'B', name: sideBName, points: state.side_b_points, gamesWon: state.side_b_games_won },
            ].map((entry) => {
              const serving = state.serving_side === entry.side;
              return (
                <article className={`pickleball-side-card ${serving && showService ? 'serving' : ''}`} key={entry.side}>
                  <div className="pickleball-side-name">
                    <span>{entry.name}</span>
                    {serving && showService && <em>Serving{showServer ? ` · Server ${state.server_number}` : ''}</em>}
                  </div>
                  <strong className="pickleball-current-points">{entry.points}</strong>
                  <div className="pickleball-games-won">Games won <b>{entry.gamesWon}</b></div>
                  <button
                    type="button"
                    className="pickleball-point-button"
                    disabled={!canScore || busy}
                    onClick={() => sendAction('award_point', { side: entry.side })}
                    aria-label={`Award rally to ${entry.name}`}
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    className="pickleball-minus-button"
                    disabled={!canScore || busy || entry.points === 0}
                    onClick={() => sendAction('remove_point', { side: entry.side })}
                  >
                    −1 correction
                  </button>
                </article>
              );
            })}
          </section>

          <section className="pickleball-controls" aria-label="Pickleball match controls">
            <button type="button" disabled={busy || !state.can_undo || game.status !== 'ongoing'} onClick={() => sendAction('undo')}>
              <RotateCcw size={18} /> Undo last action
            </button>
            {showService && canScore && (
              <button type="button" disabled={busy} onClick={() => sendAction('change_service')}>
                <RefreshCw size={18} /> Change service
              </button>
            )}
            {showServer && canScore && [1, 2].map((number) => (
              <button
                type="button"
                className={state.server_number === number ? 'active' : ''}
                disabled={busy}
                onClick={() => sendAction('set_server', { server_number: number })}
                key={number}
              >
                Server {number}
              </button>
            ))}
          </section>

          {betweenGames && (
            <section className="pickleball-next-game">
              <Check size={22} />
              <div><strong>Game {state.current_game_number} complete</strong><span>Review the score below before continuing.</span></div>
              <Button disabled={busy} onClick={() => sendAction('start_next_game')}>Start Next Game</Button>
            </section>
          )}

          {completedGames.length > 0 && (
            <section className="pickleball-game-breakdown">
              <h2>Completed games</h2>
              <div>
                {completedGames.map((completed) => (
                  <span key={completed.id || completed.sequence_number}>
                    Game {completed.sequence_number}: <b>{completed.side_a_points}–{completed.side_b_points}</b>
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="pickleball-final-section">
            <label htmlFor="pickleball-remarks">Remarks (optional)</label>
            <textarea id="pickleball-remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} />
            {readyToSubmit && (
              <Button size="lg" className="w-full" disabled={busy} onClick={() => setConfirmOpen(true)}>
                <Trophy size={19} /> Review Final Result
              </Button>
            )}
            {state.match_state === 'pending_approval' && <p className="pickleball-lifecycle-note">Result is waiting for admin approval.</p>}
            {state.match_state === 'approved' && <p className="pickleball-lifecycle-note approved">Result approved.</p>}
          </section>
        </>
      )}

      {error && <div className="pickleball-error" role="alert">{error}</div>}

      <ModalBase
        isOpen={confirmOpen}
        onClose={() => { if (!busy) setConfirmOpen(false); }}
        title="Submit Pickleball Result?"
        subtitle={isAdminRole(user.role)
          ? 'This admin submission is approved immediately.'
          : 'This result will wait for admin approval.'}
        size="sm"
        closeDisabled={busy}
        initialFocusRef={cancelRef}
        footer={(
          <>
            <button ref={cancelRef} type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirmOpen(false)}>Cancel</button>
            <button type="button" className="btn-danger" disabled={busy || state?.match_state !== 'ready_to_submit'} onClick={submitFinal}>
              {busy ? 'Submitting…' : 'Confirm Final Result'}
            </button>
          </>
        )}
      >
        <div className="pickleball-confirmation">
          <dl>
            <dt>Tournament</dt><dd>{tournament.name}</dd>
            <dt>Division</dt><dd>{formatLabel(tournament.division)}</dd>
            <dt>Format</dt><dd>{formatLabel(tournament.competition_format)}</dd>
            <dt>Winner</dt><dd><strong>{winnerName || 'Not determined'}</strong></dd>
            <dt>Remarks</dt><dd>{remarks.trim() || 'None'}</dd>
          </dl>
          <div className="pickleball-confirm-games">
            {completedGames.map((completed) => (
              <span key={completed.id || completed.sequence_number}>Game {completed.sequence_number}: {completed.side_a_points}–{completed.side_b_points}</span>
            ))}
          </div>
          <p>{isAdminRole(user.role)
            ? 'Approval may update standings and advance the bracket winner immediately.'
            : 'Normal scoring is locked after submission unless an admin rejects and reopens the result.'}</p>
          {error && <div className="pickleball-error" role="alert">{error}</div>}
        </div>
      </ModalBase>
    </div>
  );
}
