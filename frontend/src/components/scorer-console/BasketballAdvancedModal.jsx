import { useEffect, useState } from 'react';
import ModalBase from '../ModalBase';
import { SCORER_ACTIONS } from '../../utils/scorerActions.js';

const COPY = {
  reset: {
    title: 'Reset Game Clock?',
    subtitle: 'This restores the configured period time and stops the game clock.',
    confirm: 'Reset Game Clock',
    action: SCORER_ACTIONS.GAME_CLOCK_RESET,
  },
  next: {
    title: 'Advance to Next Period?',
    subtitle: 'This increments the period and resets both Basketball clocks.',
    confirm: 'Advance Period',
    action: SCORER_ACTIONS.NEXT_PERIOD,
  },
  set: {
    title: 'Set Game Time',
    subtitle: 'Enter the exact official remaining game time.',
    confirm: 'Set Official Time',
    action: SCORER_ACTIONS.GAME_CLOCK_SET,
  },
};

export default function BasketballAdvancedModal({ type, game, pending, onClose, onConfirm }) {
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const copy = COPY[type];

  useEffect(() => {
    if (type !== 'set') return;
    const total = Number.isSafeInteger(game?.game_clock_remaining) ? game.game_clock_remaining : 0;
    setMinutes(String(Math.floor(total / 60)));
    setSeconds(String(total % 60));
  }, [type, game?.game_clock_remaining]);

  if (!copy) return null;

  async function confirm() {
    const payload = type === 'set'
      ? { seconds: (Number(minutes) * 60) + Number(seconds) }
      : {};
    const result = await onConfirm(copy.action, payload);
    if (result?.status === 'accepted') onClose();
  }

  const invalidTime = type === 'set' && (
    !/^\d+$/.test(minutes) || !/^\d+$/.test(seconds) ||
    Number(minutes) < 0 || Number(minutes) > 60 || Number(seconds) < 0 || Number(seconds) > 59 ||
    (Number(minutes) * 60) + Number(seconds) > 3600
  );

  return (
    <ModalBase
      isOpen={Boolean(copy)}
      onClose={onClose}
      title={copy.title}
      subtitle={copy.subtitle}
      closeDisabled={pending}
      size="sm"
      footer={(
        <>
          <button type="button" className="btn-secondary" disabled={pending} onClick={onClose}>Cancel</button>
          <button type="button" className="btn-danger" disabled={pending || invalidTime} onClick={confirm}>
            {pending ? 'Processing…' : copy.confirm}
          </button>
        </>
      )}
    >
      {type === 'set' ? (
        <div className="basketball-time-fields">
          <label>Minutes<input inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
          <span>:</span>
          <label>Seconds<input inputMode="numeric" value={seconds} onChange={(event) => setSeconds(event.target.value)} /></label>
          {invalidTime && <p role="alert">Enter 0–60 minutes and 0–59 seconds, up to one hour total.</p>}
        </div>
      ) : (
        <p>This action changes the official live clock for every connected scorer and Public View.</p>
      )}
    </ModalBase>
  );
}
