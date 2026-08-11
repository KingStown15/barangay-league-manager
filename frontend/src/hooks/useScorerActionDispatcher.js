import { useCallback, useEffect, useRef, useState } from 'react';
import { SESSION_EXPIRED_EVENT } from '../api/client.js';
import { buildScorerActionRequest, executeScorerActionRequest, scorerActionLabel } from '../utils/scorerActions.js';
import { classifyScorerActionError, getScorerActionGuard, isTextEntryElement } from '../utils/scorerActionGuards.js';

function actionResult({
  status,
  message,
  action = null,
  authoritative = null,
  meta = null,
  reloadRequired = false,
  controlsShouldRemainArmed = false,
}) {
  return { status, message, action, authoritative, meta, reloadRequired, controlsShouldRemainArmed };
}

export default function useScorerActionDispatcher({
  game,
  sport,
  authorized = true,
  connectionState = 'connected',
  restoring = false,
  modalOpen = false,
  getActionContext,
  onAccepted,
  reloadAuthoritative,
} = {}) {
  const [armed, setArmed] = useState(false);
  const [resumeRequired, setResumeRequired] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const lockRef = useRef(false);
  const mountedRef = useRef(true);
  const previousConnectionRef = useRef(connectionState);
  const hasConnectedRef = useRef(connectionState === 'connected');
  const hiddenSinceRef = useRef(false);
  const recoverySequenceRef = useRef(0);
  const recoveryPromiseRef = useRef(null);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const disarmControls = useCallback((message = 'Scorer controls disabled.') => {
    setArmed(false);
    if (message) setFeedback({ status: 'blocked', message, action: null });
  }, []);

  const restoreBeforeResume = useCallback((pendingMessage, acceptedMessage) => {
    if (recoveryPromiseRef.current) return recoveryPromiseRef.current;
    const sequence = ++recoverySequenceRef.current;
    setArmed(false);
    setResumeRequired(true);
    setFeedback(actionResult({ status: 'pending', message: pendingMessage }));
    const recovery = Promise.resolve(reloadAuthoritative?.())
      .then(() => {
        if (mountedRef.current && sequence === recoverySequenceRef.current) {
          setFeedback(actionResult({ status: 'accepted', message: acceptedMessage }));
        }
      })
      .catch((error) => {
        if (mountedRef.current && sequence === recoverySequenceRef.current) {
          setFeedback(actionResult({
            status: 'rejected',
            message: error?.message || 'Official state could not be restored.',
            reloadRequired: true,
          }));
        }
      })
      .finally(() => {
        if (sequence === recoverySequenceRef.current) recoveryPromiseRef.current = null;
      });
    recoveryPromiseRef.current = recovery;
    return recovery;
  }, [reloadAuthoritative]);

  useEffect(() => {
    recoverySequenceRef.current += 1;
    recoveryPromiseRef.current = null;
    hiddenSinceRef.current = false;
    lockRef.current = false;
    setPendingAction(null);
    setArmed(false);
    setResumeRequired(false);
    setFeedback(null);
  }, [game?.id]);

  useEffect(() => {
    if (game?.status && game.status !== 'ongoing') {
      disarmControls(`Controls disabled — match is ${game.status}.`);
    }
  }, [game?.status, disarmControls]);

  useEffect(() => {
    if (modalOpen) {
      setResumeRequired(true);
      disarmControls('Confirmation opened. Review it, then resume scorer controls.');
    }
  }, [modalOpen, disarmControls]);

  useEffect(() => {
    if (restoring) {
      setResumeRequired(true);
      disarmControls('Restoring official state. Controls disabled.');
    }
  }, [restoring, disarmControls]);

  useEffect(() => {
    const previous = previousConnectionRef.current;
    previousConnectionRef.current = connectionState;
    if (connectionState !== 'connected') {
      if (hasConnectedRef.current) setResumeRequired(true);
      disarmControls(connectionState === 'reconnecting'
        ? 'Connection interrupted. Controls disabled while reconnecting.'
        : 'Server disconnected. Controls disabled.');
      return;
    }
    if (!hasConnectedRef.current) {
      hasConnectedRef.current = true;
      setFeedback(actionResult({ status: 'accepted', message: 'Server connected. Review the official state, then enable scorer controls.' }));
      return;
    }
    if (previous && previous !== 'connected') {
      restoreBeforeResume(
        'Connection restored. Reloading official state before controls can resume…',
        'Official state restored. Review it, then resume controls.',
      );
    }
  }, [connectionState, disarmControls, restoreBeforeResume]);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = true;
        setResumeRequired(true);
        disarmControls('Console moved to the background. Review the official state and resume controls.');
        return;
      }
      if (hiddenSinceRef.current) {
        hiddenSinceRef.current = false;
        restoreBeforeResume(
          'Console visible again. Reloading official state before controls can resume…',
          'Official state restored after background return. Review it, then resume controls.',
        );
      }
    }
    function handleSessionExpired() {
      disarmControls('Session expired. Sign in again to continue scoring.');
    }
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, [disarmControls, restoreBeforeResume]);

  const guard = useCallback((armedValue = armed, confirmed = false) => getScorerActionGuard({
    armed: armedValue,
    authorized,
    game,
    pending: lockRef.current,
    modalOpen: confirmed ? false : modalOpen,
    inputActive: confirmed ? false : (typeof document !== 'undefined' && isTextEntryElement(document.activeElement)),
    documentHidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
    restoring,
    connectionState,
  }), [armed, authorized, game, modalOpen, restoring, connectionState]);

  const armControls = useCallback(() => {
    const result = guard(true);
    if (!result.allowed) {
      setArmed(false);
      setFeedback(actionResult({ status: result.status, message: result.message }));
      return result;
    }
    setArmed(true);
    setResumeRequired(false);
    setFeedback(actionResult({ status: 'accepted', message: 'Scorer controls active.', controlsShouldRemainArmed: true }));
    return result;
  }, [guard]);

  const runDispatch = useCallback(async (action, payload = {}, confirmed = false) => {
    const guarded = guard(confirmed ? true : armed, confirmed);
    if (!guarded.allowed) {
      const result = actionResult({
        status: guarded.status,
        message: guarded.message,
        action,
        reloadRequired: guarded.status === 'stale',
      });
      setFeedback(result);
      return result;
    }

    let specification;
    try {
      specification = buildScorerActionRequest(action, {
        game,
        sport,
        ...(getActionContext?.() || {}),
        ...payload,
      });
    } catch (error) {
      const result = actionResult({
        status: 'rejected',
        message: error.message || 'Unable to prepare scorer action.',
        action,
        controlsShouldRemainArmed: armed,
      });
      setFeedback(result);
      return result;
    }
    if (!specification.ok) {
      const requiresReload = specification.status === 'stale';
      const result = actionResult({
        status: specification.status,
        message: specification.message,
        action,
        reloadRequired: requiresReload,
        controlsShouldRemainArmed: armed && !requiresReload,
      });
      setFeedback(result);
      if (requiresReload) {
        setArmed(false);
        setResumeRequired(true);
      }
      return result;
    }

    lockRef.current = true;
    setPendingAction(action);
    const actionLabel = scorerActionLabel(action, specification.meta);
    setFeedback(actionResult({ status: 'pending', message: `${actionLabel}…`, action, controlsShouldRemainArmed: armed }));
    try {
      const accepted = await executeScorerActionRequest(specification);
      await onAccepted?.(accepted, specification);
      const result = actionResult({
        status: 'accepted',
        message: `${actionLabel} accepted.`,
        action,
        authoritative: accepted,
        meta: specification.meta,
        controlsShouldRemainArmed: armed,
      });
      if (mountedRef.current) setFeedback(result);
      return result;
    } catch (error) {
      const status = classifyScorerActionError(error);
      const requiresReload = status === 'stale' || !error?.status;
      const shouldDisarm = status === 'stale' || status === 'unauthorized' || !error?.status;
      const result = actionResult({
        status,
        message: error.message || 'Scorer action failed.',
        action,
        reloadRequired: requiresReload,
        controlsShouldRemainArmed: armed && !shouldDisarm,
      });
      if (shouldDisarm) {
        setArmed(false);
        setResumeRequired(true);
      }
      if (status === 'stale') {
        try { await reloadAuthoritative?.(); } catch {}
      }
      if (mountedRef.current) setFeedback(result);
      return result;
    } finally {
      lockRef.current = false;
      if (mountedRef.current) setPendingAction(null);
    }
  }, [armed, game, sport, getActionContext, onAccepted, reloadAuthoritative, guard]);

  const dispatch = useCallback((action, payload = {}) => runDispatch(action, payload, false), [runDispatch]);
  const dispatchConfirmed = useCallback((action, payload = {}) => runDispatch(action, payload, true), [runDispatch]);

  return {
    armed,
    resumeRequired,
    pending: Boolean(pendingAction),
    pendingAction,
    feedback,
    armControls,
    disarmControls,
    dispatch,
    dispatchConfirmed,
    setFeedback,
  };
}
