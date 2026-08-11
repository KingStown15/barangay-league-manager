import { useEffect, useRef, useState, useCallback } from 'react';
import { Clock, Timer, Play, Pause, RotateCcw, ChevronRight, ChevronDown } from 'lucide-react';
import { selectLiveGameSnapshot } from '../utils/liveGameState';
import { buildScorerActionRequest, executeScorerActionRequest, SCORER_ACTIONS } from '../utils/scorerActions';
import Button from './ui/Button';
import ModalBase from './ModalBase';

function formatGameClock(seconds) {
  if (seconds === null || seconds === undefined) return '--:--';
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatShotClock(seconds) {
  if (seconds === null || seconds === undefined) return '--';
  const s = Math.max(0, Math.round(seconds));
  return String(s).padStart(2, '0');
}

export default function BasketballClock({ game, disabled, onGameUpdate, loadGames, toast, hideDisplay, compact }) {
  const tickRef = useRef(null);
  const confirmTimer = useRef(null);
  const seqRef = useRef(0);
  const confirmedBaseGameRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [gameBusy, setGameBusy] = useState(false);
  const [shotBusy, setShotBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [showSetTime, setShowSetTime] = useState(false);
  const [setTimeMinutes, setSetTimeMinutes] = useState('10');
  const [setTimeSeconds, setSetTimeSeconds] = useState('00');
  const [confirmedGame, setConfirmedGame] = useState(null);
  const [showMore, setShowMore] = useState(false);

  const isOngoing = game?.status === 'ongoing';
  const showControls = isOngoing;
  const canControl = showControls && !disabled;

  const computeDisplay = useCallback(() => {
    const src = selectLiveGameSnapshot(game, confirmedGame, confirmedBaseGameRef.current);
    if (!src) return { gameClock: null, gameRunning: false, shotClock: null, shotRunning: false };
    const nowMs = Date.now();
    let gc = src.game_clock_remaining;
    let gcRunning = !!src.game_clock_running;
    if (gcRunning && src.game_clock_started_at && gc !== null) {
      const elapsed = Math.max(0, Math.floor((nowMs - new Date(src.game_clock_started_at).getTime()) / 1000));
      gc = Math.max(0, gc - elapsed);
    }
    let sc = src.shot_clock_remaining;
    let scRunning = !!src.shot_clock_running;
    if (scRunning && src.shot_clock_started_at && sc !== null) {
      const elapsed = Math.max(0, Math.floor((nowMs - new Date(src.shot_clock_started_at).getTime()) / 1000));
      sc = Math.max(0, sc - elapsed);
    }
    return { gameClock: gc, gameRunning: gcRunning, shotClock: sc, shotRunning: scRunning };
  }, [game, confirmedGame]);

  const [display, setDisplay] = useState(computeDisplay);

  useEffect(() => {
    setDisplay(computeDisplay());
  }, [computeDisplay]);

  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      setDisplay(computeDisplay());
    }, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [computeDisplay]);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible' && loadGames) {
        loadGames(game?.tournament_id);
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [loadGames, game?.tournament_id]);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  function requestConfirm(type) {
    if (confirmAction === type) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      setConfirmAction(null);
      return true;
    }
    setConfirmAction(type);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmAction(null), 3000);
    return false;
  }

  function cancelConfirm() {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmAction(null);
  }

  async function sendClockAction(action, extra) {
    if (busy || !game) return;
    const isGameAction = ['start_game_clock', 'pause_game_clock', 'reset_game_clock', 'set_game_clock'].includes(action);
    const isShotAction = ['start_shot_clock', 'pause_shot_clock', 'reset_shot_clock'].includes(action);
    if (isGameAction && gameBusy) return;
    if (isShotAction && shotBusy) return;

    const seq = ++seqRef.current;

    setBusy(true);
    if (isGameAction) setGameBusy(true);
    if (isShotAction) setShotBusy(true);
    try {
      const scorerAction = ({
        start_game_clock: SCORER_ACTIONS.GAME_CLOCK_START,
        pause_game_clock: SCORER_ACTIONS.GAME_CLOCK_PAUSE,
        reset_game_clock: SCORER_ACTIONS.GAME_CLOCK_RESET,
        set_game_clock: SCORER_ACTIONS.GAME_CLOCK_SET,
        start_shot_clock: SCORER_ACTIONS.SHOT_CLOCK_START,
        pause_shot_clock: SCORER_ACTIONS.SHOT_CLOCK_PAUSE,
        reset_shot_clock: SCORER_ACTIONS.SHOT_CLOCK_RESET_24,
        next_period: SCORER_ACTIONS.NEXT_PERIOD,
      })[action];
      const specification = buildScorerActionRequest(scorerAction, {
        game,
        sport: 'basketball',
        ...(extra || {}),
      });
      if (!specification.ok) throw new Error(specification.message);
      const accepted = await executeScorerActionRequest(specification);
      if (accepted.game && seq === seqRef.current) {
        confirmedBaseGameRef.current = game;
        setConfirmedGame(accepted.game);
        onGameUpdate?.(accepted.game);
      }
    } catch (err) {
      toast?.error?.(err?.message || 'Clock action failed.');
    } finally {
      setBusy(false);
      if (isGameAction) setGameBusy(false);
      if (isShotAction) setShotBusy(false);
    }
  }

  function handleStartGameClock() { sendClockAction('start_game_clock'); }
  function handlePauseGameClock() { sendClockAction('pause_game_clock'); }
  function handleResetGameClock() {
    if (requestConfirm('reset_game_clock')) {
      sendClockAction('reset_game_clock');
    }
  }
  function handleSetTime() {
    const m = parseInt(setTimeMinutes, 10);
    const s = parseInt(setTimeSeconds, 10);
    if (isNaN(m) || isNaN(s) || m < 0 || m > 60 || s < 0 || s > 59) {
      toast?.error?.('Invalid time. Enter minutes (0-60) and seconds (0-59).');
      return;
    }
    const total = m * 60 + s;
    if (total < 0 || total > 3600) {
      toast?.error?.('Total time must be between 0 and 3600 seconds.');
      return;
    }
    sendClockAction('set_game_clock', { seconds: total });
    setShowSetTime(false);
  }

  function handleStartShotClock() { sendClockAction('start_shot_clock'); }
  function handlePauseShotClock() { sendClockAction('pause_shot_clock'); }
  function handleResetShotClock() { sendClockAction('reset_shot_clock'); }
  function handleNextPeriod() {
    if (requestConfirm('next_period')) {
      sendClockAction('next_period');
    }
  }

  if (!showControls) return null;

  const period = game?.current_period != null ? `Q${game.current_period}` : 'Q1';
  const gameRunning = display.gameRunning;
  const shotRunning = display.shotRunning;
  const shotExpired = display.shotClock !== null && display.shotClock <= 0;

  const cnf = confirmAction;

  if (compact) {
    return (
      <div className="scorer-quick-clock">
        <div className="quick-clock-row">
          <span className="quick-clock-label">Game:</span>
          {gameRunning ? (
            <button className="quick-clock-btn quick-clock-btn-pause" disabled={gameBusy} onClick={handlePauseGameClock}>
              <Pause size={15} strokeWidth={2.5} /> Pause
            </button>
          ) : (
            <button className="quick-clock-btn quick-clock-btn-play" disabled={gameBusy} onClick={handleStartGameClock}>
              <Play size={15} strokeWidth={2.5} /> Start
            </button>
          )}
        </div>
        <div className="quick-clock-row">
          <span className="quick-clock-label">Shot:</span>
          {shotRunning ? (
            <button className="quick-clock-btn quick-clock-btn-pause" disabled={shotBusy} onClick={handlePauseShotClock}>
              <Pause size={15} strokeWidth={2.5} /> Pause
            </button>
          ) : (
            <button className="quick-clock-btn quick-clock-btn-play" disabled={shotBusy} onClick={handleStartShotClock}>
              <Play size={15} strokeWidth={2.5} /> Start
            </button>
          )}
          <button className="quick-clock-btn quick-clock-btn-reset" disabled={shotBusy} onClick={handleResetShotClock}>
            <RotateCcw size={15} strokeWidth={2.5} /> Reset 24
          </button>
        </div>
        <button className="quick-clock-more-toggle" onClick={() => setShowMore(s => !s)}>
          <ChevronDown size={14} strokeWidth={2.5} style={{ transform: showMore ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
          {showMore ? 'Less Clock Controls' : 'More Clock Controls'}
        </button>

        {showMore && (
          <div className="quick-clock-more">
            {cnf === 'reset_game_clock' ? (
              <div className="quick-clock-more-row">
                <button className="quick-clock-btn quick-clock-btn-danger" disabled={gameBusy} onClick={handleResetGameClock}>
                  Tap again to Reset
                </button>
                <button className="quick-clock-btn quick-clock-btn-cancel" disabled={gameBusy} onClick={cancelConfirm}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="quick-clock-more-row">
                <button className="quick-clock-btn quick-clock-btn-secondary" disabled={gameBusy} onClick={handleResetGameClock}>
                  <RotateCcw size={14} strokeWidth={2.5} /> Reset Game Clock
                </button>
                <button className="quick-clock-btn quick-clock-btn-secondary" disabled={gameBusy || gameRunning} onClick={() => {
                  const parts = formatGameClock(display.gameClock).split(':');
                  setSetTimeMinutes(parts[0]);
                  setSetTimeSeconds(parts[1]);
                  setShowSetTime(true);
                }}>
                  <Clock size={14} strokeWidth={2.5} /> Set Game Time
                </button>
              </div>
            )}
            <div className="quick-clock-more-row" style={{ marginTop: '6px' }}>
              {cnf === 'next_period' ? (
                <>
                  <button className="quick-clock-btn quick-clock-btn-danger" disabled={gameBusy || shotBusy} onClick={handleNextPeriod}>
                    Tap again to advance
                  </button>
                  <button className="quick-clock-btn quick-clock-btn-cancel" onClick={cancelConfirm}>
                    Cancel
                  </button>
                </>
              ) : (
                <button className="quick-clock-btn quick-clock-btn-secondary" disabled={gameBusy || shotBusy} onClick={handleNextPeriod}>
                  <ChevronRight size={14} strokeWidth={2.5} /> Next Period
                </button>
              )}
            </div>
          </div>
        )}

        {showSetTime && (
          <ModalBase isOpen={showSetTime} onClose={() => { setShowSetTime(false); cancelConfirm(); }} title="Set Game Clock" size="sm"
            footer={
              <>
                <button type="button" className="btn-secondary" onClick={() => { setShowSetTime(false); cancelConfirm(); }}>Cancel</button>
                <button type="button" className="btn-primary" onClick={handleSetTime}>Set</button>
              </>
            }
          >
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label className="label">Minutes</label>
                <input className="input" type="number" min="0" max="60" value={setTimeMinutes} onChange={(e) => setSetTimeMinutes(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="label">Seconds</label>
                <input className="input" type="number" min="0" max="59" value={setTimeSeconds} onChange={(e) => setSetTimeSeconds(e.target.value)} />
              </div>
            </div>
          </ModalBase>
        )}
      </div>
    );
  }

  return (
    <div className="scorer-form-section" style={{ marginBottom: '6px' }}>
      <div className="card" style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        padding: '10px 12px', borderRadius: '12px',
      }}>
        {!hideDisplay && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <span style={{
              fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em',
              background: 'var(--color-primary-soft, #dbeafe)', color: 'var(--color-primary, #2563eb)',
              padding: '3px 8px', borderRadius: '6px', whiteSpace: 'nowrap',
            }}>
              {period}
            </span>
            <span style={{
              fontSize: '22px', fontWeight: 900, fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.02em', color: 'var(--color-text)',
            }}>
              {formatGameClock(display.gameClock)}
            </span>
            <span style={{
              fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
              padding: '3px 8px', borderRadius: '6px', whiteSpace: 'nowrap',
              color: shotExpired ? 'var(--color-danger, #DC2626)' : 'var(--color-text-muted)',
              background: shotExpired ? 'rgba(220,38,38,0.1)' : 'var(--color-surface-hover, #f1f5f9)',
            }}>
              SHOT {formatShotClock(display.shotClock)}
              {shotExpired && <span style={{ marginLeft: '3px', fontWeight: 800 }}>EXPIRED</span>}
            </span>
            {gameRunning && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '3px',
                fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em',
                color: 'var(--color-success, #16A34A)', marginLeft: 'auto',
              }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-success, #16A34A)', animation: 'livePulse 1.6s infinite' }} />
                LIVE
              </span>
            )}
          </div>
        )}

        {/* Game Clock Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)', minWidth: '36px' }}>
            Game:
          </span>
          {cnf === 'reset_game_clock' ? (
            <>
              <Button size="lg" style={{ minHeight: '48px', fontSize: '14px' }} variant="danger" disabled={gameBusy} onClick={handleResetGameClock}>
              Tap again to Reset
              </Button>
              <Button size="lg" style={{ minHeight: '48px', fontSize: '13px', paddingLeft: '14px', paddingRight: '14px' }} variant="ghost" disabled={gameBusy} onClick={cancelConfirm}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="lg" style={{ minHeight: '48px', fontSize: '14px', flex: '1 0 auto', minWidth: 0 }} disabled={gameBusy || gameRunning} onClick={handleStartGameClock}>
                <Play size={15} strokeWidth={2.5} /> <span>Start</span>
              </Button>
              <Button size="lg" style={{ minHeight: '48px', fontSize: '14px', flex: '1 0 auto', minWidth: 0 }} variant="secondary" disabled={gameBusy || !gameRunning} onClick={handlePauseGameClock}>
                <Pause size={15} strokeWidth={2.5} /> <span>Pause</span>
              </Button>
              <Button size="lg" style={{ minHeight: '48px', fontSize: '14px', flex: '1 0 auto', minWidth: 0 }} variant="secondary" disabled={gameBusy} onClick={handleResetGameClock}>
                <RotateCcw size={15} strokeWidth={2.5} /> <span>Reset</span>
              </Button>
              <Button size="lg" style={{ minHeight: '48px', fontSize: '14px', flex: '0 0 auto' }} variant="secondary" disabled={gameBusy || gameRunning} onClick={() => {
                const parts = formatGameClock(display.gameClock).split(':');
                setSetTimeMinutes(parts[0]);
                setSetTimeSeconds(parts[1]);
                setShowSetTime(true);
              }}>
                <Clock size={15} strokeWidth={2.5} /> <span>Set</span>
              </Button>
            </>
          )}
        </div>

        {/* Shot Clock Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)', minWidth: '36px' }}>
            Shot:
          </span>
          <Button size="lg" style={{ minHeight: '48px', fontSize: '14px', flex: '1 0 auto', minWidth: 0 }} disabled={shotBusy || shotRunning} onClick={handleStartShotClock}>
            <Play size={15} strokeWidth={2.5} /> <span>Start</span>
          </Button>
          <Button size="lg" style={{ minHeight: '48px', fontSize: '14px', flex: '1 0 auto', minWidth: 0 }} variant="secondary" disabled={shotBusy || !shotRunning} onClick={handlePauseShotClock}>
            <Pause size={15} strokeWidth={2.5} /> <span>Pause</span>
          </Button>
          <Button size="lg" style={{ minHeight: '48px', fontSize: '14px', flex: '0 0 auto' }} variant="secondary" disabled={shotBusy} onClick={handleResetShotClock}>
            <RotateCcw size={15} strokeWidth={2.5} /> <span>Reset 24</span>
          </Button>
        </div>

        {/* Period row — separated */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--color-border)' }}>
          {cnf === 'next_period' ? (
            <>
              <Button size="lg" style={{ minHeight: '48px', fontSize: '14px' }} variant="danger" disabled={busy} onClick={handleNextPeriod}>
                Tap again to advance
              </Button>
              <Button size="lg" style={{ minHeight: '48px', fontSize: '13px', paddingLeft: '14px', paddingRight: '14px' }} variant="ghost" disabled={busy} onClick={cancelConfirm}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="lg" style={{ minHeight: '48px', fontSize: '14px' }} variant="secondary" disabled={gameBusy || shotBusy} onClick={handleNextPeriod}>
              <ChevronRight size={15} strokeWidth={2.5} /> <span>Next Period</span>
            </Button>
          )}
        </div>
      </div>

      {showSetTime && (
        <ModalBase isOpen={showSetTime} onClose={() => { setShowSetTime(false); cancelConfirm(); }} title="Set Game Clock" size="sm"
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => { setShowSetTime(false); cancelConfirm(); }}>Cancel</button>
              <button type="button" className="btn-primary" onClick={handleSetTime}>Set</button>
            </>
          }
        >
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label className="label">Minutes</label>
              <input className="input" type="number" min="0" max="60" value={setTimeMinutes} onChange={(e) => setSetTimeMinutes(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Seconds</label>
              <input className="input" type="number" min="0" max="59" value={setTimeSeconds} onChange={(e) => setSetTimeSeconds(e.target.value)} />
            </div>
          </div>
        </ModalBase>
      )}
    </div>
  );
}
