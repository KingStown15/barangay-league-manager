import ModalBase from '../ModalBase';
import { SCORER_ACTIONS } from '../../utils/scorerActions.js';

const COPY = {
  undo: {
    title: 'Undo Last Pickleball Action?',
    subtitle: 'This restores the one authoritative state saved before the most recent action.',
    confirm: 'Undo Last Action',
    action: SCORER_ACTIONS.PICKLEBALL_UNDO_LAST_ACTION,
  },
  next: {
    title: 'Start Next Pickleball Game?',
    subtitle: 'The completed game stays in match history and service initializes for the next game.',
    confirm: 'Start Next Game',
    action: SCORER_ACTIONS.PICKLEBALL_START_NEXT_GAME,
  },
  switch: {
    title: 'Switch Screen Sides?',
    subtitle: 'This changes only the Phone Console layout.',
    confirm: 'Switch Screen Sides',
  },
};

export default function PickleballAdvancedModal({ type, pending, onClose, onConfirm, onScreenSwap }) {
  const copy = COPY[type];
  if (!copy) return null;

  async function confirm() {
    if (type === 'switch') {
      onScreenSwap();
      onClose();
      return;
    }
    const result = await onConfirm(copy.action);
    if (result?.status === 'accepted') onClose();
  }

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
          <button type="button" className="btn-danger" disabled={pending} onClick={confirm}>
            {pending ? 'Processing…' : copy.confirm}
          </button>
        </>
      )}
    >
      {type === 'switch' ? (
        <p>Side A and Side B identities, scores, serving state, and Public View are not changed.</p>
      ) : (
        <p>This is a versioned match-lifecycle action. Stale state is rejected and reloaded before another action can run.</p>
      )}
    </ModalBase>
  );
}
