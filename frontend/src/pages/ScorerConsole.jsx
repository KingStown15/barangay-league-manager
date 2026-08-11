import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Smartphone } from 'lucide-react';
import ModalBase from '../components/ModalBase';
import MoreControlsDrawer from '../components/scorer-console/MoreControlsDrawer';
import ScorerConsoleShell from '../components/scorer-console/ScorerConsoleShell';
import BasketballAdvancedModal from '../components/scorer-console/BasketballAdvancedModal';
import BasketballConsole from '../components/scorer-console/BasketballConsole';
import VolleyballAdvancedModal from '../components/scorer-console/VolleyballAdvancedModal';
import VolleyballConsole from '../components/scorer-console/VolleyballConsole';
import PickleballAdvancedModal from '../components/scorer-console/PickleballAdvancedModal';
import PickleballConsole from '../components/scorer-console/PickleballConsole';
import { useAuth } from '../context/AuthContext';
import useScorerActionDispatcher from '../hooks/useScorerActionDispatcher';
import useScorerConsoleGame from '../hooks/useScorerConsoleGame';
import { getGameSideName } from '../utils/entryDisplay';
import { canEnableConsoleControls, parseConsoleGameId } from '../utils/scorerConsoleState';
import { canReopenVolleyballSet, getVolleyballConsoleSnapshot } from '../utils/volleyballConsoleState';
import { canScorePickleball, canStartNextPickleballGame } from '../utils/pickleballConsoleState';
import '../scorer-console.css';

export default function ScorerConsole() {
  const { gameId: routeGameId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const gameId = parseConsoleGameId(routeGameId);
  const consoleGame = useScorerConsoleGame(gameId);
  const [moreOpen, setMoreOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [basketballModal, setBasketballModal] = useState(null);
  const [volleyballModal, setVolleyballModal] = useState(null);
  const [pickleballModal, setPickleballModal] = useState(null);
  const [basketballUndo, setBasketballUndo] = useState({ A: null, B: null });
  const [volleyballUndo, setVolleyballUndo] = useState({ A: null, B: null });
  const [volleyballScreenSwapped, setVolleyballScreenSwapped] = useState(false);
  const [pickleballScreenSwapped, setPickleballScreenSwapped] = useState(false);
  const acceptedBasketballScoreRef = useRef(null);
  const observedBasketballScoreRef = useRef(null);
  const acceptedVolleyballScoreRef = useRef(null);
  const observedVolleyballScoreRef = useRef(null);
  const modalOpen = moreOpen || exitOpen || Boolean(basketballModal) || Boolean(volleyballModal) || Boolean(pickleballModal);

  const handleAccepted = useCallback((accepted, specification) => {
    if (specification?.meta?.sport === 'basketball' && specification.meta.kind === 'score' && accepted?.game) {
      acceptedBasketballScoreRef.current = {
        A: accepted.game.live_score_a ?? accepted.game.score_a ?? 0,
        B: accepted.game.live_score_b ?? accepted.game.score_b ?? 0,
      };
      setBasketballUndo((previous) => ({
        ...previous,
        [specification.meta.side]: specification.meta.undo ? null : specification.meta.previousScore,
      }));
    }
    if (specification?.meta?.sport === 'volleyball' && accepted?.game?.volleyball) {
      const state = accepted.game.volleyball;
      acceptedVolleyballScoreRef.current = getVolleyballConsoleSnapshot(state, accepted.game.id);
      if (specification.meta.kind === 'score') {
        const canReverse = !(specification.meta.backendAction === 'subtract_point' && state.current_set?.winner);
        setVolleyballUndo((previous) => ({
          ...previous,
          [specification.meta.side]: specification.meta.undo || !canReverse ? null : specification.meta.previousScore,
        }));
      } else {
        setVolleyballUndo({ A: null, B: null });
      }
    }
    consoleGame.applyActionResult(accepted);
  }, [consoleGame.applyActionResult]);

  const dispatcher = useScorerActionDispatcher({
    game: consoleGame.game,
    sport: consoleGame.game?.sport,
    authorized: Boolean(user),
    connectionState: consoleGame.connectionState,
    restoring: consoleGame.restoring,
    modalOpen,
    getActionContext: () => ({
      volleyballState: consoleGame.game?.volleyball,
      pickleballState: consoleGame.pickleball?.state,
    }),
    onAccepted: handleAccepted,
    reloadAuthoritative: consoleGame.reloadAuthoritative,
  });

  useEffect(() => {
    const game = consoleGame.game;
    if (game?.sport !== 'basketball') {
      observedBasketballScoreRef.current = null;
      acceptedBasketballScoreRef.current = null;
      setBasketballUndo({ A: null, B: null });
      return;
    }
    const observed = {
      id: game.id,
      A: game.live_score_a ?? game.score_a ?? 0,
      B: game.live_score_b ?? game.score_b ?? 0,
    };
    const previous = observedBasketballScoreRef.current;
    const accepted = acceptedBasketballScoreRef.current;
    if (!previous || previous.id !== observed.id) {
      setBasketballUndo({ A: null, B: null });
    } else if (accepted && accepted.A === observed.A && accepted.B === observed.B) {
      acceptedBasketballScoreRef.current = null;
    } else {
      setBasketballUndo((undo) => ({
        A: previous.A !== observed.A ? null : undo.A,
        B: previous.B !== observed.B ? null : undo.B,
      }));
    }
    observedBasketballScoreRef.current = observed;
  }, [consoleGame.game?.id, consoleGame.game?.sport, consoleGame.game?.live_score_a, consoleGame.game?.live_score_b, consoleGame.game?.score_a, consoleGame.game?.score_b]);

  useEffect(() => {
    if (dispatcher.feedback?.status === 'stale') setBasketballUndo({ A: null, B: null });
  }, [dispatcher.feedback?.status]);

  useEffect(() => {
    const game = consoleGame.game;
    if (game?.sport !== 'volleyball' || !game.volleyball) {
      observedVolleyballScoreRef.current = null;
      acceptedVolleyballScoreRef.current = null;
      setVolleyballUndo({ A: null, B: null });
      return;
    }
    const observed = getVolleyballConsoleSnapshot(game.volleyball, game.id);
    const previous = observedVolleyballScoreRef.current;
    const accepted = acceptedVolleyballScoreRef.current;
    const sameLifecycle = previous && previous.gameId === observed.gameId
      && previous.setNumber === observed.setNumber
      && previous.setsA === observed.setsA
      && previous.setsB === observed.setsB
      && previous.matchComplete === observed.matchComplete;
    if (!sameLifecycle) {
      setVolleyballUndo({ A: null, B: null });
    } else if (accepted && accepted.scoreA === observed.scoreA && accepted.scoreB === observed.scoreB
      && accepted.setNumber === observed.setNumber && accepted.setsA === observed.setsA && accepted.setsB === observed.setsB) {
      acceptedVolleyballScoreRef.current = null;
    } else {
      setVolleyballUndo((undo) => ({
        A: previous.scoreA !== observed.scoreA ? null : undo.A,
        B: previous.scoreB !== observed.scoreB ? null : undo.B,
      }));
    }
    observedVolleyballScoreRef.current = observed;
  }, [consoleGame.game?.id, consoleGame.game?.sport, consoleGame.game?.volleyball?.sets_won_a, consoleGame.game?.volleyball?.sets_won_b, consoleGame.game?.volleyball?.current_set?.set_number, consoleGame.game?.volleyball?.current_set?.team_a_score, consoleGame.game?.volleyball?.current_set?.team_b_score, consoleGame.game?.volleyball?.match_complete]);

  useEffect(() => {
    if (dispatcher.feedback?.status === 'stale') setVolleyballUndo({ A: null, B: null });
  }, [dispatcher.feedback?.status]);

  useEffect(() => {
    setVolleyballScreenSwapped(false);
    setPickleballScreenSwapped(false);
  }, [consoleGame.game?.id]);

  useEffect(() => {
    if (consoleGame.game?.sport === 'volleyball' && consoleGame.game?.volleyball?.match_complete) {
      dispatcher.disarmControls('Volleyball match complete. Review and submit the final result in Full Scorer.');
    }
  }, [consoleGame.game?.sport, consoleGame.game?.volleyball?.match_complete, dispatcher.disarmControls]);

  useEffect(() => {
    const state = consoleGame.pickleball?.state;
    if (consoleGame.game?.sport === 'pickleball' && state && !canScorePickleball(state)) {
      dispatcher.disarmControls(state.match_state === 'between_games'
        ? 'Pickleball game complete. Review it before starting the next game.'
        : 'Pickleball match scoring is complete. Review and submit in Full Scorer.');
    }
  }, [consoleGame.game?.sport, consoleGame.pickleball?.state?.match_state, dispatcher.disarmControls]);

  const canEnable = useMemo(() => canEnableConsoleControls({
    game: consoleGame.game,
    connectionState: consoleGame.connectionState,
    restoring: consoleGame.restoring,
    documentHidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
    hasError: Boolean(consoleGame.error),
  })
    && !(consoleGame.game?.sport === 'volleyball' && consoleGame.game?.volleyball?.match_complete)
    && !(consoleGame.game?.sport === 'pickleball' && !canScorePickleball(consoleGame.pickleball?.state)), [consoleGame.game, consoleGame.connectionState, consoleGame.restoring, consoleGame.error, consoleGame.pickleball?.state?.match_state]);

  function openFullScorer() {
    dispatcher.disarmControls('Opening Full Scorer. Console controls disabled.');
    navigate('/scorer');
  }

  function requestExit() {
    setMoreOpen(false);
    setBasketballModal(null);
    setVolleyballModal(null);
    setPickleballModal(null);
    setExitOpen(true);
  }

  function toggleVolleyballScreenSides() {
    setVolleyballScreenSwapped((swapped) => !swapped);
    dispatcher.disarmControls('');
    dispatcher.setFeedback({ status: 'accepted', message: 'Screen sides switched. Stored Side A and Side B identities did not change.', action: null });
  }

  function togglePickleballScreenSides() {
    setPickleballScreenSwapped((swapped) => !swapped);
    dispatcher.disarmControls('');
    dispatcher.setFeedback({ status: 'accepted', message: 'Screen sides switched. Stored Pickleball Side A and Side B identities did not change.', action: null });
  }

  function confirmExit() {
    dispatcher.disarmControls('Scorer Console exited.');
    setExitOpen(false);
    navigate('/scorer');
  }

  if (!gameId) {
    return (
      <div className="console-load-state error" role="alert">
        <AlertTriangle size={36} />
        <h1>Invalid game link</h1>
        <p>Open Scorer Console from an eligible game in Full Scorer.</p>
        <button type="button" onClick={() => navigate('/scorer')}>Open Full Scorer</button>
      </div>
    );
  }

  if (consoleGame.loading && !consoleGame.game) {
    return <div className="console-load-state" role="status"><Smartphone size={36} /><h1>Loading Scorer Console…</h1></div>;
  }

  if (consoleGame.error && !consoleGame.game) {
    return (
      <div className="console-load-state error" role="alert">
        <AlertTriangle size={36} />
        <h1>Console unavailable</h1>
        <p>{consoleGame.error}</p>
        <button type="button" onClick={() => consoleGame.reloadAuthoritative().catch(() => {})}>Try Again</button>
        <button type="button" className="secondary" onClick={() => navigate('/scorer')}>Open Full Scorer</button>
      </div>
    );
  }

  const sideA = getGameSideName(consoleGame.game, 'a', 'Side A');
  const sideB = getGameSideName(consoleGame.game, 'b', 'Side B');
  const isBasketball = consoleGame.game?.sport === 'basketball';
  const isVolleyball = consoleGame.game?.sport === 'volleyball';
  const isPickleball = consoleGame.game?.sport === 'pickleball';

  return (
    <>
      <ScorerConsoleShell
        game={consoleGame.game}
        tournament={consoleGame.tournament}
        user={user}
        connectionState={consoleGame.connectionState}
        restoring={consoleGame.restoring}
        armed={dispatcher.armed}
        resumeRequired={dispatcher.resumeRequired}
        pending={dispatcher.pending}
        feedback={dispatcher.feedback}
        canEnable={canEnable}
        onArm={dispatcher.armControls}
        onDisarm={dispatcher.disarmControls}
        onMore={() => setMoreOpen(true)}
        onOpenFullScorer={openFullScorer}
        onExit={requestExit}
      >
        {isBasketball ? (
          <BasketballConsole
            game={consoleGame.game}
            sideAName={sideA}
            sideBName={sideB}
            armed={dispatcher.armed}
            pending={dispatcher.pending}
            pendingAction={dispatcher.pendingAction}
            previousScores={basketballUndo}
            dispatch={dispatcher.dispatch}
          />
        ) : isVolleyball && consoleGame.game?.volleyball ? (
          <VolleyballConsole
            game={consoleGame.game}
            sideAName={sideA}
            sideBName={sideB}
            armed={dispatcher.armed}
            pending={dispatcher.pending}
            pendingAction={dispatcher.pendingAction}
            previousScores={volleyballUndo}
            dispatch={dispatcher.dispatch}
            onOpenConfirm={() => setVolleyballModal('confirm')}
            screenSidesSwapped={volleyballScreenSwapped}
          />
        ) : isPickleball && consoleGame.pickleball?.state ? (
          <PickleballConsole
            game={consoleGame.game}
            tournament={consoleGame.tournament}
            match={consoleGame.pickleball}
            sideAName={sideA}
            sideBName={sideB}
            armed={dispatcher.armed}
            pending={dispatcher.pending}
            pendingAction={dispatcher.pendingAction}
            dispatch={dispatcher.dispatch}
            screenSidesSwapped={pickleballScreenSwapped}
          />
        ) : (
          <section className="console-shell-preview" aria-label="Selected game">
            <article><span>Side A</span><strong>{sideA}</strong></article>
            <div><Smartphone size={28} /><strong>Touch Console Ready</strong><span>Sport controls load in this game workspace.</span></div>
            <article><span>Side B</span><strong>{sideB}</strong></article>
          </section>
        )}
      </ScorerConsoleShell>

      <MoreControlsDrawer
        isOpen={moreOpen}
        onClose={() => setMoreOpen(false)}
        onOpenFullScorer={openFullScorer}
        onExit={requestExit}
      >
        {isBasketball && (
          <>
            <button type="button" onClick={() => { setMoreOpen(false); setBasketballModal('set'); }}>
              <span><strong>Set Game Time</strong><small>Enter the exact official remaining time</small></span>
            </button>
            <button type="button" className="danger" onClick={() => { setMoreOpen(false); setBasketballModal('reset'); }}>
              <span><strong>Reset Game Clock</strong><small>Confirmation required</small></span>
            </button>
            <button type="button" onClick={() => { setMoreOpen(false); setBasketballModal('next'); }}>
              <span><strong>Next Period</strong><small>Advance and reset Basketball clocks</small></span>
            </button>
          </>
        )}
        {isVolleyball && (
          <>
            <button
              type="button"
              disabled={!canReopenVolleyballSet(consoleGame.game?.volleyball)}
              onClick={() => { setMoreOpen(false); setVolleyballModal('reopen'); }}
            >
              <span><strong>Reopen Previous Set</strong><small>Available before new-set points are entered</small></span>
            </button>
            <button type="button" onClick={openFullScorer}>
              <span><strong>Correct Set in Full Scorer</strong><small>Use the full correction and final-result workspace</small></span>
            </button>
            <button type="button" onClick={() => { setMoreOpen(false); setVolleyballModal('switch'); }}>
              <span><strong>Switch Screen Sides</strong><small>Presentation only; stored identities stay unchanged</small></span>
            </button>
          </>
        )}
        {isPickleball && (
          <>
            <button
              type="button"
              disabled={!consoleGame.pickleball?.state?.can_undo}
              onClick={() => { setMoreOpen(false); setPickleballModal('undo'); }}
            >
              <span><strong>Undo Last Match Action</strong><small>Protected recovery for completed-game transitions</small></span>
            </button>
            <button
              type="button"
              disabled={!canStartNextPickleballGame(consoleGame.pickleball?.state)}
              onClick={() => { setMoreOpen(false); setPickleballModal('next'); }}
            >
              <span><strong>Start Next Game</strong><small>Available after reviewing a completed game</small></span>
            </button>
            <button type="button" onClick={openFullScorer}>
              <span><strong>Review / Submit in Full Scorer</strong><small>Final submission and advanced correction stay protected</small></span>
            </button>
            <button type="button" onClick={() => { setMoreOpen(false); setPickleballModal('switch'); }}>
              <span><strong>Switch Screen Sides</strong><small>Presentation only; stored identities stay unchanged</small></span>
            </button>
          </>
        )}
      </MoreControlsDrawer>
      <BasketballAdvancedModal
        type={basketballModal}
        game={consoleGame.game}
        pending={dispatcher.pending}
        onClose={() => setBasketballModal(null)}
        onConfirm={dispatcher.dispatchConfirmed}
      />
      <VolleyballAdvancedModal
        type={volleyballModal}
        pending={dispatcher.pending}
        onClose={() => setVolleyballModal(null)}
        onConfirm={dispatcher.dispatchConfirmed}
        onScreenSwap={toggleVolleyballScreenSides}
      />
      <PickleballAdvancedModal
        type={pickleballModal}
        pending={dispatcher.pending}
        onClose={() => setPickleballModal(null)}
        onConfirm={dispatcher.dispatchConfirmed}
        onScreenSwap={togglePickleballScreenSides}
      />
      <ModalBase
        isOpen={exitOpen}
        onClose={() => setExitOpen(false)}
        title="Exit Scorer Console?"
        subtitle="Live state is already stored on the server. Controls will remain disabled."
        size="sm"
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setExitOpen(false)}>Stay in Console</button>
            <button type="button" className="btn-danger" onClick={confirmExit}>Exit Console</button>
          </>
        )}
      >
        <p>Use Full Scorer for remarks, advanced corrections, or final submission.</p>
      </ModalBase>
    </>
  );
}
