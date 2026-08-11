import ModalBase from '../ModalBase';
import { SCORER_ACTIONS } from '../../utils/scorerActions.js';

const COPY = {
  confirm: {
    title: 'Confirm Completed Set?',
    subtitle: 'The set winner and completed-set history will update for every connected view.',
    confirm: 'Confirm Set',
    action: SCORER_ACTIONS.VOLLEYBALL_CONFIRM_SET,
  },
  reopen: {
    title: 'Reopen Previous Set?',
    subtitle: 'The last confirmed set returns to point correction.',
    confirm: 'Reopen Set',
    action: SCORER_ACTIONS.VOLLEYBALL_REOPEN_SET,
  },
  switch: {
    title: 'Switch Screen Sides?',
    subtitle: 'This changes only the Phone Console layout.',
    confirm: 'Switch Screen Sides',
  },
};

export default function VolleyballAdvancedModal({ type, pending, onClose, onConfirm, onScreenSwap }) {
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
        <p>Side A and Side B identities, scores, server data, and Public View are not changed.</p>
      ) : (
        <p>This action changes the official Volleyball set lifecycle and requires current authoritative state.</p>
      )}
    </ModalBase>
  );
}
