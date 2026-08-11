import { Pause, Play, RotateCcw } from 'lucide-react';
import { useBasketballLiveClock } from '../../utils/useBasketballLiveClock.js';
import { SCORER_ACTIONS } from '../../utils/scorerActions.js';
import ConsoleActionButton from './ConsoleActionButton';

function scoreOf(game, side) {
  const value = side === 'A' ? game.live_score_a ?? game.score_a : game.live_score_b ?? game.score_b;
  return Number.isSafeInteger(value) ? value : 0;
}

function TeamPanel({ side, name, score, previousScore, armed, pending, dispatch }) {
  const blue = side === 'A';
  const actions = blue ? {
    add1: SCORER_ACTIONS.SIDE_A_ADD_1,
    add2: SCORER_ACTIONS.SIDE_A_ADD_2,
    add3: SCORER_ACTIONS.SIDE_A_ADD_3,
    subtract: SCORER_ACTIONS.SIDE_A_SUBTRACT_1,
    undo: SCORER_ACTIONS.SIDE_A_UNDO,
  } : {
    add1: SCORER_ACTIONS.SIDE_B_ADD_1,
    add2: SCORER_ACTIONS.SIDE_B_ADD_2,
    add3: SCORER_ACTIONS.SIDE_B_ADD_3,
    subtract: SCORER_ACTIONS.SIDE_B_SUBTRACT_1,
    undo: SCORER_ACTIONS.SIDE_B_UNDO,
  };
  const locked = !armed || pending;
  return (
    <section className={`basketball-console-team side-${side.toLowerCase()}`} aria-label={`${name} score controls`}>
      <div className="basketball-team-name"><span>Side {side}</span><strong>{name}</strong></div>
      <output className="basketball-team-score" aria-label={`${name} score ${score}`}>{score}</output>
      <div className="basketball-score-actions">
        <ConsoleActionButton tone={blue ? 'blue' : 'red'} label={`Add 1 point to ${name}`} disabled={locked} onClick={() => dispatch(actions.add1)}>+1</ConsoleActionButton>
        <ConsoleActionButton tone={blue ? 'blue' : 'red'} label={`Add 2 points to ${name}`} disabled={locked} onClick={() => dispatch(actions.add2)}>+2</ConsoleActionButton>
        <ConsoleActionButton tone={blue ? 'blue' : 'red'} label={`Add 3 points to ${name}`} disabled={locked} onClick={() => dispatch(actions.add3)}>+3</ConsoleActionButton>
        <ConsoleActionButton label={`Subtract 1 point from ${name}`} disabled={locked || score <= 0} onClick={() => dispatch(actions.subtract)}>−1</ConsoleActionButton>
        <ConsoleActionButton
          className="basketball-undo"
          label={`Undo last ${name} score action`}
          disabled={locked || !Number.isSafeInteger(previousScore)}
          onClick={() => dispatch(actions.undo, side === 'A' ? { previousScoreA: previousScore } : { previousScoreB: previousScore })}
        >
          <RotateCcw size={15} /> Undo
        </ConsoleActionButton>
      </div>
    </section>
  );
}

export default function BasketballConsole({ game, sideAName, sideBName, armed, pending, pendingAction, previousScores, dispatch }) {
  const display = useBasketballLiveClock(game);
  const scoreA = scoreOf(game, 'A');
  const scoreB = scoreOf(game, 'B');
  const locked = !armed || pending;
  const gameRunning = Boolean(game.game_clock_running);
  const shotRunning = Boolean(game.shot_clock_running);
  const gameAction = gameRunning ? SCORER_ACTIONS.GAME_CLOCK_PAUSE : SCORER_ACTIONS.GAME_CLOCK_START;
  const shotAction = shotRunning ? SCORER_ACTIONS.SHOT_CLOCK_PAUSE : SCORER_ACTIONS.SHOT_CLOCK_START;

  return (
    <div className="basketball-console">
      <TeamPanel side="A" name={sideAName} score={scoreA} previousScore={previousScores.A} armed={armed} pending={pending} dispatch={dispatch} />
      <section className="basketball-console-clock" aria-label="Basketball clocks">
        <div className="basketball-period">{display?.period || `Q${game.current_period || 1}`}</div>
        <output className="basketball-game-clock" aria-label={`Game clock ${display?.gameClock || '--:--'}`}>{display?.gameClock || '--:--'}</output>
        <div className={`basketball-shot-clock ${display?.shotExpired ? 'expired' : ''}`}>
          <span>Shot Clock</span>
          <output aria-label={`Shot clock ${display?.shotClock || '--'}`}>{display?.shotClock || '--'}</output>
        </div>
        <div className="basketball-clock-actions">
          <ConsoleActionButton
            tone="green"
            label={`${gameRunning ? 'Pause' : 'Start'} game clock`}
            disabled={locked}
            onClick={() => dispatch(gameAction)}
          >
            {gameRunning ? <Pause size={16} /> : <Play size={16} />}{gameRunning ? 'Pause Game' : 'Start Game'}
          </ConsoleActionButton>
          <ConsoleActionButton
            tone="green"
            label={`${shotRunning ? 'Pause' : 'Start'} shot clock`}
            disabled={locked}
            onClick={() => dispatch(shotAction)}
          >
            {shotRunning ? <Pause size={16} /> : <Play size={16} />}{shotRunning ? 'Pause Shot' : 'Start Shot'}
          </ConsoleActionButton>
          <ConsoleActionButton
            tone="amber"
            label="Reset shot clock to 24 seconds"
            disabled={locked}
            onClick={() => dispatch(SCORER_ACTIONS.SHOT_CLOCK_RESET_24)}
          >
            <RotateCcw size={16} /> Reset 24
          </ConsoleActionButton>
        </div>
        {pendingAction && <span className="basketball-pending-action">Processing action…</span>}
      </section>
      <TeamPanel side="B" name={sideBName} score={scoreB} previousScore={previousScores.B} armed={armed} pending={pending} dispatch={dispatch} />
    </div>
  );
}
