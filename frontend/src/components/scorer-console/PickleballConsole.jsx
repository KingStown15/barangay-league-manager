import { RefreshCw, RotateCcw } from 'lucide-react';
import { SCORER_ACTIONS } from '../../utils/scorerActions.js';
import { canScorePickleball, getPickleballFormatLabel, getPickleballStateMessage } from '../../utils/pickleballConsoleState.js';
import ConsoleActionButton from './ConsoleActionButton';

function TeamPanel({ position, side, name, points, gamesWon, serving, state, armed, pending, dispatch }) {
  const sideA = side === 'A';
  const addAction = sideA ? SCORER_ACTIONS.SIDE_A_ADD_1 : SCORER_ACTIONS.SIDE_B_ADD_1;
  const subtractAction = sideA ? SCORER_ACTIONS.SIDE_A_SUBTRACT_1 : SCORER_ACTIONS.SIDE_B_SUBTRACT_1;
  const locked = !armed || pending || !canScorePickleball(state);
  return (
    <section className={`pickleball-console-team position-${position} side-${side.toLowerCase()} ${serving ? 'serving' : ''}`} aria-label={`${name} Pickleball controls`}>
      <div className="pickleball-team-name">
        <span>Side {side}</span><strong>{name}</strong>
        {serving && <em>Serving{state.server_number ? ` · Server ${state.server_number}` : ''}</em>}
      </div>
      <output className="pickleball-team-points" aria-label={`${name} points ${points}`}>{points}</output>
      <div className="pickleball-team-games">Games won <strong>{gamesWon}</strong></div>
      <div className="pickleball-score-actions">
        <ConsoleActionButton
          tone={sideA ? 'blue' : 'red'}
          label={`Award rally to ${name}`}
          disabled={locked}
          onClick={() => dispatch(addAction)}
        >
          +1
        </ConsoleActionButton>
        <ConsoleActionButton
          label={`Remove 1 point from ${name}`}
          disabled={locked || points <= 0}
          onClick={() => dispatch(subtractAction)}
        >
          −1
        </ConsoleActionButton>
      </div>
    </section>
  );
}

export default function PickleballConsole({ game, tournament, match, sideAName, sideBName, armed, pending, pendingAction, dispatch, screenSidesSwapped }) {
  const state = match?.state;
  if (!state) return <div className="console-shell-preview"><div><strong>Pickleball state unavailable</strong><span>Reload the match before scoring.</span></div></div>;
  const rules = state.rules || {};
  const message = getPickleballStateMessage(state);
  const panels = {
    A: { side: 'A', name: sideAName, points: state.side_a_points, gamesWon: state.side_a_games_won, serving: state.serving_side === 'A' },
    B: { side: 'B', name: sideBName, points: state.side_b_points, gamesWon: state.side_b_games_won, serving: state.serving_side === 'B' },
  };
  const left = panels[screenSidesSwapped ? 'B' : 'A'];
  const right = panels[screenSidesSwapped ? 'A' : 'B'];
  const servingName = state.serving_side === 'A' ? sideAName : sideBName;
  const showService = Boolean(rules.track_service);
  const showServer = rules.competition_format === 'doubles' && rules.track_server_number;
  const locked = !armed || pending || !canScorePickleball(state);

  return (
    <div className="pickleball-console">
      <TeamPanel position="left" {...left} state={state} armed={armed} pending={pending} dispatch={dispatch} />
      <section className="pickleball-console-center" aria-label="Pickleball match status">
        <div className="pickleball-game-heading"><span>Game {state.current_game_number}</span><strong>{state.side_a_games_won} <small>GAMES</small> {state.side_b_games_won}</strong></div>
        <div className={`pickleball-state-message ${message.tone}`}><strong>{message.title}</strong><span>{message.detail}</span></div>
        <div className="pickleball-service-state">
          <span>{showService ? 'Serving' : 'Service tracking off'}</span>
          <strong>{showService ? servingName : '—'}{showServer ? ` · Server ${state.server_number}` : ''}</strong>
        </div>
        <div className="pickleball-format">{getPickleballFormatLabel(tournament, rules)}</div>
        <div className="pickleball-completed-games" aria-label="Completed games">
          {(match.completed_games || []).length > 0
            ? match.completed_games.map((completed) => <span key={completed.id || completed.sequence_number}>G{completed.sequence_number} {completed.side_a_points}–{completed.side_b_points}</span>)
            : <span>No completed games</span>}
        </div>
        {screenSidesSwapped && <div className="pickleball-screen-swap">Screen sides swapped only</div>}
        <div className={`pickleball-match-actions ${showServer ? 'with-server' : ''}`}>
          <ConsoleActionButton
            label="Undo last Pickleball action"
            disabled={!armed || pending || !state.can_undo}
            onClick={() => dispatch(SCORER_ACTIONS.PICKLEBALL_UNDO_LAST_ACTION)}
          >
            <RotateCcw size={15} /> Undo
          </ConsoleActionButton>
          {showService && (
            <ConsoleActionButton tone="green" label="Change service" disabled={locked} onClick={() => dispatch(SCORER_ACTIONS.PICKLEBALL_CHANGE_SERVICE)}>
              <RefreshCw size={15} /> Service
            </ConsoleActionButton>
          )}
          {showServer && [1, 2].map((number) => (
            <ConsoleActionButton
              key={number}
              tone={state.server_number === number ? 'amber' : 'neutral'}
              label={`Set server ${number}`}
              disabled={locked || state.server_number === number}
              onClick={() => dispatch(number === 1 ? SCORER_ACTIONS.PICKLEBALL_SET_SERVER_1 : SCORER_ACTIONS.PICKLEBALL_SET_SERVER_2)}
            >
              Server {number}
            </ConsoleActionButton>
          ))}
        </div>
        {pendingAction && <span className="pickleball-pending-action">Processing action…</span>}
      </section>
      <TeamPanel position="right" {...right} state={state} armed={armed} pending={pending} dispatch={dispatch} />
    </div>
  );
}
