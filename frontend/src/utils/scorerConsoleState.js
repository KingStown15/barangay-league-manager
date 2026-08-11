import { applyLiveGameOverlay } from './liveGameState.js';

export function parseConsoleGameId(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function getConsoleMatchStatus(game) {
  const status = String(game?.status || 'unknown').toLowerCase();
  if (status === 'ongoing') return { key: 'ongoing', label: 'ONGOING', tone: 'live', interactive: true };
  if (status === 'scheduled') return { key: 'scheduled', label: 'SCHEDULED', tone: 'neutral', interactive: false };
  if (status === 'completed' && !game?.approved_at) return { key: 'pending', label: 'PENDING APPROVAL', tone: 'warning', interactive: false };
  if (status === 'completed') return { key: 'completed', label: 'COMPLETED', tone: 'success', interactive: false };
  if (status === 'forfeited' && !game?.approved_at) return { key: 'pending', label: 'FORFEIT PENDING', tone: 'warning', interactive: false };
  if (status === 'forfeited') return { key: 'completed', label: 'FORFEITED', tone: 'neutral', interactive: false };
  return { key: status, label: status.replaceAll('_', ' ').toUpperCase(), tone: 'neutral', interactive: false };
}

export function getConsoleConnectionStatus(connectionState) {
  if (connectionState === 'connected') return { label: 'CONNECTED', tone: 'success' };
  if (connectionState === 'connecting' || connectionState === 'reconnecting') return { label: 'RECONNECTING', tone: 'warning' };
  return { label: 'DISCONNECTED', tone: 'danger' };
}

export function shouldUseLiveOverlay(overlay, requestStartedAt) {
  return Boolean(overlay && Number(overlay.updated_at) >= Number(requestStartedAt));
}

export function mergeConsoleSnapshot(authoritativeGame, overlay, requestStartedAt) {
  return shouldUseLiveOverlay(overlay, requestStartedAt)
    ? applyLiveGameOverlay(authoritativeGame, overlay)
    : authoritativeGame;
}

export function canEnableConsoleControls({ game, connectionState, restoring, documentHidden, hasError = false }) {
  return getConsoleMatchStatus(game).interactive &&
    connectionState === 'connected' &&
    !restoring &&
    !documentHidden &&
    !hasError;
}
