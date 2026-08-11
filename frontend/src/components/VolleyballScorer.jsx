import { Minus, RotateCcw, Trophy } from 'lucide-react';
import { useState } from 'react';
import { buildScorerActionRequest, executeScorerActionRequest, SCORER_ACTIONS } from '../utils/scorerActions';
import Button from './ui/Button';

export default function VolleyballScorer({ game, onGameUpdate, toast }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const state = game.volleyball;

  if (!state) return <div className="scorer-form-section">Reload the game to initialize volleyball scoring.</div>;

  async function act(action, side) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const scorerAction = action === 'confirm_set'
        ? SCORER_ACTIONS.VOLLEYBALL_CONFIRM_SET
        : action === 'undo_last_set'
          ? SCORER_ACTIONS.VOLLEYBALL_REOPEN_SET
          : side === 'A'
            ? (action === 'add_point' ? SCORER_ACTIONS.SIDE_A_ADD_1 : SCORER_ACTIONS.SIDE_A_SUBTRACT_1)
            : (action === 'add_point' ? SCORER_ACTIONS.SIDE_B_ADD_1 : SCORER_ACTIONS.SIDE_B_SUBTRACT_1);
      const specification = buildScorerActionRequest(scorerAction, {
        game,
        sport: 'volleyball',
        volleyballState: state,
      });
      if (!specification.ok) throw new Error(specification.message);
      const accepted = await executeScorerActionRequest(specification);
      onGameUpdate(accepted.game);
      if (action === 'confirm_set') toast.success(accepted.game.volleyball.match_complete ? 'Match won — review and submit the final result.' : 'Set confirmed.');
      if (action === 'undo_last_set') toast.success('Previous set reopened for correction.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const current = state.current_set;
  const canUndoSet = current && current.team_a_score === 0 && current.team_b_score === 0 && state.completed_sets.length > 0;

  return (
    <div className="scorer-form-section">
      <div className="scorer-remarks-card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '.12em' }}>
              {state.rules.format === 'best_of_5' ? 'Championship · Best of 5' : 'Best of 3'}
            </div>
            <strong style={{ fontSize: 18 }}>Sets won {state.sets_won_a}–{state.sets_won_b}</strong>
          </div>
          {current && <span className="game-status-badge">Set {current.set_number} · To {current.target}</span>}
        </div>

        {state.completed_sets.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {state.completed_sets.map((set) => (
              <span key={set.set_number} className="game-score-chip" style={{ width: 'auto', padding: '0 10px', fontSize: 13 }}>
                S{set.set_number} {set.team_a_score}–{set.team_b_score}
              </span>
            ))}
          </div>
        )}

        {current ? (
          <>
            <div className="scorer-team-grid">
              {[
                ['A', game.team_a_name || 'Team A', current.team_a_score],
                ['B', game.team_b_name || 'Team B', current.team_b_score],
              ].map(([side, name, score]) => (
                <div className="scorer-team-card" key={side} style={{ padding: 16 }}>
                  <div className="team-name">{name}</div>
                  <div className="team-score">{score}</div>
                  <button className="score-btn score-btn-soft" disabled={busy || Boolean(current.winner)} onClick={() => act('add_point', side)}>+1</button>
                  <button className="score-btn score-btn-danger" style={{ marginTop: 8 }} disabled={busy || score <= 0} onClick={() => act('subtract_point', side)}>
                    <Minus size={18} /> 1
                  </button>
                </div>
              ))}
            </div>
            {current.winner && (
              <div style={{ marginTop: 14, padding: 14, borderRadius: 10, background: 'var(--color-success-soft, #DCFCE7)', textAlign: 'center' }}>
                <strong>Set {current.set_number} complete: {current.team_a_score}–{current.team_b_score}</strong>
                <div style={{ fontSize: 12, margin: '5px 0 10px', color: 'var(--color-text-muted)' }}>Point controls are locked until this set is confirmed or corrected.</div>
                <Button disabled={busy} onClick={() => act('confirm_set')}><Trophy size={17} /> Confirm Set</Button>
              </div>
            )}
            {canUndoSet && (
              <button type="button" className="btn-ghost" style={{ marginTop: 12 }} disabled={busy} onClick={() => act('undo_last_set')}>
                <RotateCcw size={15} /> Reopen previous set
              </button>
            )}
          </>
        ) : (
          <div style={{ padding: 16, textAlign: 'center', borderRadius: 10, background: 'var(--color-success-soft, #DCFCE7)' }}>
            <Trophy size={24} style={{ margin: '0 auto 8px' }} />
            <strong>Match complete: {state.sets_won_a}–{state.sets_won_b}</strong>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>Review the set scores, then submit the final result below.</div>
            <button type="button" className="btn-ghost" style={{ marginTop: 10 }} disabled={busy} onClick={() => act('undo_last_set')}>
              <RotateCcw size={15} /> Reopen final set
            </button>
          </div>
        )}
        {error && <div role="alert" style={{ color: 'var(--color-danger)', marginTop: 10, fontSize: 13 }}>{error}</div>}
      </div>
    </div>
  );
}
