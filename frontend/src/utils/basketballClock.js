export function formatGameClock(seconds) {
  if (seconds === null || seconds === undefined) return '--:--';
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function formatShotClock(seconds) {
  if (seconds === null || seconds === undefined) return '--';
  const s = Math.max(0, Math.round(seconds));
  return String(s).padStart(2, '0');
}

export function shouldShowBasketballClock(game) {
  if (!game) return false;
  return game.sport === 'basketball' && game.status === 'ongoing';
}

export function getBasketballClockDisplay(game, nowMs) {
  if (!shouldShowBasketballClock(game)) return null;

  const period = game.current_period != null ? `Q${game.current_period}` : 'Q1';

  let gc = game.game_clock_remaining;
  if (nowMs != null && game.game_clock_running && game.game_clock_started_at && gc != null) {
    const elapsed = Math.max(0, Math.floor((nowMs - new Date(game.game_clock_started_at).getTime()) / 1000));
    gc = Math.max(0, gc - elapsed);
  }
  let sc = game.shot_clock_remaining;
  if (nowMs != null && game.shot_clock_running && game.shot_clock_started_at && sc != null) {
    const elapsed = Math.max(0, Math.floor((nowMs - new Date(game.shot_clock_started_at).getTime()) / 1000));
    sc = Math.max(0, sc - elapsed);
  }

  const gcFormatted = formatGameClock(gc);
  const scFormatted = formatShotClock(sc);
  const expired = sc !== null && sc <= 0;

  const shotText = expired ? `Shot ${scFormatted} EXPIRED` : `Shot ${scFormatted}`;
  return { period, gameClock: gcFormatted, shotClock: scFormatted, shotExpired: expired, text: `${period} · ${gcFormatted} · ${shotText}` };
}
