export function isTextEntryElement(element) {
  if (!element) return false;
  const tag = String(element.tagName || '').toLowerCase();
  return element.isContentEditable === true || ['input', 'textarea', 'select'].includes(tag);
}

export function getScorerActionGuard({
  armed,
  authorized = true,
  game,
  pending = false,
  modalOpen = false,
  inputActive = false,
  documentHidden = false,
  restoring = false,
  connectionState = 'connected',
} = {}) {
  if (!authorized) return { allowed: false, status: 'unauthorized', message: 'Your account cannot control this game.' };
  if (!game?.id) return { allowed: false, status: 'stale', message: 'No authoritative game is loaded.' };
  if (game.status !== 'ongoing') return { allowed: false, status: 'blocked', message: `Controls are unavailable while the game is ${game.status || 'not ongoing'}.` };
  if (connectionState !== 'connected') return { allowed: false, status: 'blocked', message: 'Server connection is not ready.' };
  if (documentHidden) return { allowed: false, status: 'blocked', message: 'Return to the visible console and resume controls.' };
  if (restoring) return { allowed: false, status: 'pending', message: 'Restoring the authoritative game state…' };
  if (modalOpen) return { allowed: false, status: 'blocked', message: 'Close the open confirmation before scoring.' };
  if (inputActive) return { allowed: false, status: 'blocked', message: 'Finish editing the active field before scoring.' };
  if (pending) return { allowed: false, status: 'pending', message: 'Wait for the current action to finish.' };
  if (!armed) return { allowed: false, status: 'blocked', message: 'Enable Scorer Controls before scoring.' };
  return { allowed: true, status: 'accepted', message: '' };
}

export function classifyScorerActionError(error) {
  if (error?.status === 401 || error?.status === 403) return 'unauthorized';
  if (error?.status === 409) return 'stale';
  if (!error?.status) return 'rejected';
  return 'rejected';
}

export function requiresAuthoritativeRestore(status) {
  return status === 'stale' || status === 'unauthorized' || status === 'rejected';
}
