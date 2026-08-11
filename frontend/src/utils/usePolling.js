import { useEffect, useRef } from 'react';

export function createRequestSession() {
  let active = true;
  return {
    isCurrent: () => active,
    cancel: () => { active = false; },
  };
}

/**
 * Runs `callback(isCurrent)` immediately and then again every `intervalMs`.
 * Async callbacks must check `isCurrent()` before applying a response so a
 * request from an old dependency value cannot overwrite the current view.
 */
export function usePolling(callback, deps, intervalMs = 7000) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  });

  useEffect(() => {
    const session = createRequestSession();
    savedCallback.current(session.isCurrent);
    const id = setInterval(() => savedCallback.current(session.isCurrent), intervalMs);
    return () => {
      session.cancel();
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
