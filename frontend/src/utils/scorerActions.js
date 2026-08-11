import { api } from '../api/client.js';

export const SCORER_ACTIONS = Object.freeze({
  SIDE_A_ADD_1: 'SIDE_A_ADD_1',
  SIDE_A_ADD_2: 'SIDE_A_ADD_2',
  SIDE_A_ADD_3: 'SIDE_A_ADD_3',
  SIDE_A_SUBTRACT_1: 'SIDE_A_SUBTRACT_1',
  SIDE_A_UNDO: 'SIDE_A_UNDO',
  SIDE_B_ADD_1: 'SIDE_B_ADD_1',
  SIDE_B_ADD_2: 'SIDE_B_ADD_2',
  SIDE_B_ADD_3: 'SIDE_B_ADD_3',
  SIDE_B_SUBTRACT_1: 'SIDE_B_SUBTRACT_1',
  SIDE_B_UNDO: 'SIDE_B_UNDO',

  GAME_CLOCK_START: 'GAME_CLOCK_START',
  GAME_CLOCK_PAUSE: 'GAME_CLOCK_PAUSE',
  GAME_CLOCK_RESET: 'GAME_CLOCK_RESET',
  GAME_CLOCK_SET: 'GAME_CLOCK_SET',
  SHOT_CLOCK_START: 'SHOT_CLOCK_START',
  SHOT_CLOCK_PAUSE: 'SHOT_CLOCK_PAUSE',
  SHOT_CLOCK_RESET_24: 'SHOT_CLOCK_RESET_24',
  NEXT_PERIOD: 'NEXT_PERIOD',

  VOLLEYBALL_CONFIRM_SET: 'VOLLEYBALL_CONFIRM_SET',
  VOLLEYBALL_REOPEN_SET: 'VOLLEYBALL_REOPEN_SET',

  PICKLEBALL_UNDO_LAST_ACTION: 'PICKLEBALL_UNDO_LAST_ACTION',
  PICKLEBALL_CHANGE_SERVICE: 'PICKLEBALL_CHANGE_SERVICE',
  PICKLEBALL_SET_SERVER_1: 'PICKLEBALL_SET_SERVER_1',
  PICKLEBALL_SET_SERVER_2: 'PICKLEBALL_SET_SERVER_2',
  PICKLEBALL_START_NEXT_GAME: 'PICKLEBALL_START_NEXT_GAME',
});

const BASKETBALL_SCORE_ACTIONS = Object.freeze({
  [SCORER_ACTIONS.SIDE_A_ADD_1]: { side: 'A', delta: 1 },
  [SCORER_ACTIONS.SIDE_A_ADD_2]: { side: 'A', delta: 2 },
  [SCORER_ACTIONS.SIDE_A_ADD_3]: { side: 'A', delta: 3 },
  [SCORER_ACTIONS.SIDE_A_SUBTRACT_1]: { side: 'A', delta: -1 },
  [SCORER_ACTIONS.SIDE_A_UNDO]: { side: 'A', undo: true },
  [SCORER_ACTIONS.SIDE_B_ADD_1]: { side: 'B', delta: 1 },
  [SCORER_ACTIONS.SIDE_B_ADD_2]: { side: 'B', delta: 2 },
  [SCORER_ACTIONS.SIDE_B_ADD_3]: { side: 'B', delta: 3 },
  [SCORER_ACTIONS.SIDE_B_SUBTRACT_1]: { side: 'B', delta: -1 },
  [SCORER_ACTIONS.SIDE_B_UNDO]: { side: 'B', undo: true },
});

const BASKETBALL_CLOCK_ACTIONS = Object.freeze({
  [SCORER_ACTIONS.GAME_CLOCK_START]: 'start_game_clock',
  [SCORER_ACTIONS.GAME_CLOCK_PAUSE]: 'pause_game_clock',
  [SCORER_ACTIONS.GAME_CLOCK_RESET]: 'reset_game_clock',
  [SCORER_ACTIONS.GAME_CLOCK_SET]: 'set_game_clock',
  [SCORER_ACTIONS.SHOT_CLOCK_START]: 'start_shot_clock',
  [SCORER_ACTIONS.SHOT_CLOCK_PAUSE]: 'pause_shot_clock',
  [SCORER_ACTIONS.SHOT_CLOCK_RESET_24]: 'reset_shot_clock',
  [SCORER_ACTIONS.NEXT_PERIOD]: 'next_period',
});

const SIDE_POINT_ACTIONS = Object.freeze({
  [SCORER_ACTIONS.SIDE_A_ADD_1]: { side: 'A', add: true },
  [SCORER_ACTIONS.SIDE_A_SUBTRACT_1]: { side: 'A', add: false },
  [SCORER_ACTIONS.SIDE_B_ADD_1]: { side: 'B', add: true },
  [SCORER_ACTIONS.SIDE_B_SUBTRACT_1]: { side: 'B', add: false },
});

const VOLLEYBALL_UNDO_ACTIONS = Object.freeze({
  [SCORER_ACTIONS.SIDE_A_UNDO]: { side: 'A', previousKey: 'previousVolleyballScoreA' },
  [SCORER_ACTIONS.SIDE_B_UNDO]: { side: 'B', previousKey: 'previousVolleyballScoreB' },
});

function blocked(action, message, status = 'blocked') {
  return { ok: false, action, status, message };
}

function scoreValue(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function createActionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `scorer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function volleyballExpected(state) {
  if (!state) return null;
  return {
    sets_won_a: state.sets_won_a,
    sets_won_b: state.sets_won_b,
    current_set_number: state.current_set?.set_number ?? state.completed_sets?.length ?? 0,
    current_score_a: state.current_set?.team_a_score ?? 0,
    current_score_b: state.current_set?.team_b_score ?? 0,
  };
}

function basketballRequest(action, context) {
  const game = context.game;
  const scoreAction = BASKETBALL_SCORE_ACTIONS[action];
  if (scoreAction) {
    const scoreA = scoreValue(context.scoreA ?? game.live_score_a ?? game.score_a);
    const scoreB = scoreValue(context.scoreB ?? game.live_score_b ?? game.score_b);
    const current = scoreAction.side === 'A' ? scoreA : scoreB;
    const previous = scoreAction.side === 'A' ? context.previousScoreA : context.previousScoreB;
    if (scoreAction.undo && !Number.isSafeInteger(previous)) {
      return blocked(action, `No ${scoreAction.side === 'A' ? 'left' : 'right'}-side score action is available to undo.`);
    }
    const next = scoreAction.undo ? Math.max(0, previous) : Math.max(0, current + scoreAction.delta);
    if (next === current) return blocked(action, 'The score is already zero.');
    const nextA = scoreAction.side === 'A' ? next : scoreA;
    const nextB = scoreAction.side === 'B' ? next : scoreB;
    return {
      ok: true,
      action,
      request: {
        method: 'patch',
        path: `/games/${game.id}/live-score`,
        body: {
          live_score_a: nextA,
          live_score_b: nextB,
          expected_live_score_a: scoreA,
          expected_live_score_b: scoreB,
        },
      },
      meta: {
        sport: 'basketball',
        kind: 'score',
        side: scoreAction.side,
        previousScore: current,
        nextScore: next,
        undo: Boolean(scoreAction.undo),
      },
    };
  }

  const backendAction = BASKETBALL_CLOCK_ACTIONS[action];
  if (!backendAction) return blocked(action, 'This action is not supported for Basketball.', 'unsupported');
  const body = { action: backendAction };
  if (action === SCORER_ACTIONS.GAME_CLOCK_SET) {
    if (!Number.isSafeInteger(context.seconds) || context.seconds < 0 || context.seconds > 3600) {
      return blocked(action, 'Game time must be between 0 and 3600 seconds.');
    }
    body.seconds = context.seconds;
  }
  return {
    ok: true,
    action,
    request: { method: 'patch', path: `/games/${game.id}/clock`, body },
    meta: { sport: 'basketball', kind: 'clock', backendAction },
  };
}

function volleyballRequest(action, context) {
  const state = context.volleyballState ?? context.game.volleyball;
  const expected = volleyballExpected(state);
  if (!expected) return blocked(action, 'Volleyball state is unavailable. Reload the game.', 'stale');

  const pointAction = SIDE_POINT_ACTIONS[action];
  if (pointAction) {
    const current = pointAction.side === 'A' ? expected.current_score_a : expected.current_score_b;
    const next = pointAction.add ? current + 1 : Math.max(0, current - 1);
    if (next === current) return blocked(action, 'The score is already zero.');
    return {
      ok: true,
      action,
      request: {
        method: 'patch',
        path: `/games/${context.game.id}/volleyball-score`,
        body: { action: pointAction.add ? 'add_point' : 'subtract_point', side: pointAction.side, expected },
      },
      meta: {
        sport: 'volleyball',
        kind: 'score',
        side: pointAction.side,
        previousScore: current,
        nextScore: next,
        undo: false,
        backendAction: pointAction.add ? 'add_point' : 'subtract_point',
      },
    };
  }

  const undoAction = VOLLEYBALL_UNDO_ACTIONS[action];
  if (undoAction) {
    const current = undoAction.side === 'A' ? expected.current_score_a : expected.current_score_b;
    const previous = context[undoAction.previousKey];
    if (!Number.isSafeInteger(previous) || previous < 0 || Math.abs(current - previous) !== 1) {
      return blocked(action, `No ${undoAction.side === 'A' ? 'left' : 'right'}-side point action is available to undo.`);
    }
    const backendAction = previous > current ? 'add_point' : 'subtract_point';
    return {
      ok: true,
      action,
      request: {
        method: 'patch',
        path: `/games/${context.game.id}/volleyball-score`,
        body: { action: backendAction, side: undoAction.side, expected },
      },
      meta: {
        sport: 'volleyball',
        kind: 'score',
        side: undoAction.side,
        previousScore: current,
        nextScore: previous,
        undo: true,
        backendAction,
      },
    };
  }

  const backendAction = action === SCORER_ACTIONS.VOLLEYBALL_CONFIRM_SET
    ? 'confirm_set'
    : action === SCORER_ACTIONS.VOLLEYBALL_REOPEN_SET
      ? 'undo_last_set'
      : null;
  if (!backendAction) return blocked(action, 'This action is not supported for Volleyball.', 'unsupported');
  return {
    ok: true,
    action,
    request: {
      method: 'patch',
      path: `/games/${context.game.id}/volleyball-score`,
      body: { action: backendAction, expected },
    },
    meta: { sport: 'volleyball', kind: 'lifecycle', backendAction },
  };
}

function pickleballRequest(action, context) {
  const state = context.pickleballState ?? context.pickleball?.state;
  if (!state || !Number.isSafeInteger(state.version)) {
    return blocked(action, 'Pickleball state is unavailable. Reload the match.', 'stale');
  }

  const pointAction = SIDE_POINT_ACTIONS[action];
  let backendAction;
  let payload = {};
  if (pointAction) {
    backendAction = pointAction.add ? 'award_point' : 'remove_point';
    payload = { side: pointAction.side };
  } else if (action === SCORER_ACTIONS.PICKLEBALL_UNDO_LAST_ACTION) {
    backendAction = 'undo';
  } else if (action === SCORER_ACTIONS.PICKLEBALL_CHANGE_SERVICE) {
    backendAction = 'change_service';
  } else if (action === SCORER_ACTIONS.PICKLEBALL_SET_SERVER_1 || action === SCORER_ACTIONS.PICKLEBALL_SET_SERVER_2) {
    backendAction = 'set_server';
    payload = { server_number: action === SCORER_ACTIONS.PICKLEBALL_SET_SERVER_1 ? 1 : 2 };
  } else if (action === SCORER_ACTIONS.PICKLEBALL_START_NEXT_GAME) {
    backendAction = 'start_next_game';
  } else {
    return blocked(action, 'This action is not supported for Pickleball.', 'unsupported');
  }

  return {
    ok: true,
    action,
    request: {
      method: 'post',
      path: `/games/${context.game.id}/pickleball-actions`,
      body: {
        action_id: context.actionId || createActionId(),
        expected_version: state.version,
        action: backendAction,
        payload,
      },
    },
    meta: {
      sport: 'pickleball',
      kind: backendAction === 'award_point' || backendAction === 'remove_point' ? 'score' : 'state',
      backendAction,
      side: pointAction?.side || null,
    },
  };
}

export function buildScorerActionRequest(action, context = {}) {
  const game = context.game;
  if (!game?.id) return blocked(action, 'No game is loaded.', 'stale');
  if (game.status !== 'ongoing') return blocked(action, `This game is ${game.status || 'not ongoing'}.`);
  const sport = context.sport ?? game.sport;
  if (sport === 'basketball') return basketballRequest(action, context);
  if (sport === 'volleyball') return volleyballRequest(action, context);
  if (sport === 'pickleball') return pickleballRequest(action, context);
  return blocked(action, 'This sport is not supported by Scorer Console.', 'unsupported');
}

export async function executeScorerActionRequest(specification) {
  if (!specification?.ok || !specification.request) throw new Error('A valid scorer action request is required.');
  const { method, path, body } = specification.request;
  const response = method === 'post'
    ? await api.post(path, body)
    : await api.patch(path, body);
  return {
    response,
    game: response.game || null,
    pickleball: response.state ? { state: response.state, completed_games: response.completed_games || [] } : null,
    meta: specification.meta,
  };
}

export function scorerActionLabel(action, meta = null) {
  if (meta?.sport === 'pickleball') {
    if (meta.backendAction === 'award_point') return `Side ${meta.side} Rally`;
    if (meta.backendAction === 'remove_point') return `Side ${meta.side} Point Correction`;
    if (meta.backendAction === 'undo') return 'Undo Last Pickleball Action';
    if (meta.backendAction === 'change_service') return 'Change Pickleball Service';
    if (meta.backendAction === 'set_server') return 'Set Pickleball Server';
    if (meta.backendAction === 'start_next_game') return 'Start Next Pickleball Game';
  }
  return String(action || '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}
