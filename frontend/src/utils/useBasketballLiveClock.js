import { useState, useEffect } from 'react';
import { getBasketballClockDisplay, shouldShowBasketballClock } from './basketballClock';

export function useBasketballLiveClock(game) {
  const [nowMs, setNowMs] = useState(Date.now);
  const needsTick = shouldShowBasketballClock(game);

  useEffect(() => {
    if (!needsTick) return;

    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);

    function onVisibility() {
      if (document.visibilityState === 'visible') setNowMs(Date.now());
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [needsTick]);

  return getBasketballClockDisplay(game, needsTick ? nowMs : undefined);
}
