import { RotateCcw, Trophy } from 'lucide-react';
import { SCORER_ACTIONS } from '../../utils/scorerActions.js';
import { getVolleyballSetMessage } from '../../utils/volleyballConsoleState.js';
import ConsoleActionButton from './ConsoleActionButton';

function TeamPanel({ position, side, name, score, previousScore, state, armed, pending, dispatch }) {
  const sideA = side === 'A';
  const addAction = sideA ? SCORER_ACTIONS.SIDE_A_ADD_1 : SCORER_ACTIONS.SIDE_B_ADD_1;
  const subtractAction = sideA ? SCORER_ACTIONS.SIDE_A_SUBTRACT_1 : SCORER_ACTIONS.SIDE_B_SUBTRACT_1;
  const undoAction = sideA ? SCORER_ACTIONS.SIDE_A_UNDO : SCORER_ACTIONS.SIDE_B_UNDO;
  const current = state.current_set;
  const locked = !armed || pending || !current || state.match_complete;
  return (
    <section className={`volleyball-console-team position-${position} side-${side.toLowerCase()}`} aria-label={`${name} volleyball controls`}>
      <div className="volleyball-team-name"><span>Side {side}</span><strong>{name}</strong></div>
      <output className="volleyball-team-score" aria-label={`${name} set score ${score}`}>{current ? score : '—'}</output>
      <div className="volleyball-score-actions">
        <ConsoleActionButton
          tone={sideA ? 'blue' : 'red'}
          label={`Add 1 point to ${name}`}
          disabled={locked || Boolean(current?.winner)}
          onClick={() => dispatch(addAction)}
        >
          +1
        </ConsoleActionButton>
        <ConsoleActionButton
          label={`Subtract 1 point from ${name}`}
          disabled={locked || score <= 0}
          onClick={() => dispatch(subtractAction)}
        >
          −1
        </ConsoleActionButton>
        <ConsoleActionButton
          className="volleyball-undo"
          label={`Undo last ${name} point action`}
          disabled={locked || !Number.isSafeInteger(previousScore)}
          onClick={() => dispatch(undoAction, sideA
            ? { previousVolleyballScoreA: previousScore }
            : { previousVolleyballScoreB: previousScore })}
        >
          <RotateCcw size={15} /> Undo
        </ConsoleActionButton>
      </div>
    </section>
  );
}

export default function VolleyballConsole({ game, sideAName, sideBName, armed, pending, pendingAction, previousScores, dispatch, onOpenConfirm, screenSidesSwapped }) {
  const state = game.volleyball;
  if (!state) return <div className="console-shell-preview"><div><strong>Volleyball state unavailable</strong><span>Reload the game before scoring.</span></div></div>;
  const current = state.current_set;
  const message = getVolleyballSetMessage(state);
  const panels = {
    A: { side: 'A', name: sideAName, score: current?.team_a_score ?? 0, previousScore: previousScores.A },
    B: { side: 'B', name: sideBName, score: current?.team_b_score ?? 0, previousScore: previousScores.B },
  };
  const left = panels[screenSidesSwapped ? 'B' : 'A'];
  const right = panels[screenSidesSwapped ? 'A' : 'B'];
  const bestOf = state.rules?.format === 'best_of_5' ? 5 : 3;

  return (
    <div className="volleyball-console">
      <TeamPanel position="left" {...left} state={state} armed={armed} pending={pending} dispatch={dispatch} />
      <section className="volleyball-console-center" aria-label="Volleyball set status">
        <div className="volleyball-set-heading">
          <span>{current ? `Set ${current.set_number}` : 'Match'}</span>
          <strong>{state.sets_won_a} <small>SETS</small> {state.sets_won_b}</strong>
        </div>
        <div className={`volleyball-rule-message ${message.tone}`}>
          <strong>{message.title}</strong><span>{message.detail}</span>
        </div>
        <div className="volleyball-match-format">Best of {bestOf} · First to {state.rules?.sets_to_win ?? (bestOf === 5 ? 3 : 2)} sets</div>
        <div className="volleyball-set-history" aria-label="Completed sets">
          {(state.completed_sets || []).length > 0
            ? state.completed_sets.map((set) => <span key={set.set_number}>S{set.set_number} {set.team_a_score}–{set.team_b_score}</span>)
            : <span>No completed sets</span>}
        </div>
        {screenSidesSwapped && <div className="volleyball-screen-swap">Screen sides swapped only</div>}
        <ConsoleActionButton
          tone="green"
          className="volleyball-confirm-set"
          label="Open confirm set"
          disabled={!armed || pending || !current?.winner}
          onClick={onOpenConfirm}
        >
          <Trophy size={16} /> Open Confirm Set
        </ConsoleActionButton>
        {pendingAction && <span className="volleyball-pending-action">Processing action…</span>}
      </section>
      <TeamPanel position="right" {...right} state={state} armed={armed} pending={pending} dispatch={dispatch} />
    </div>
  );
}
