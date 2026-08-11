const TOKEN_KEY = 'blm_token';
const USER_KEY = 'blm_user';
export const SESSION_EXPIRED_EVENT = 'blm:session-expired';

// This app runs standalone in the user's own browser (not inside a Claude
// artifact sandbox), so normal localStorage is the right tool here - it
// keeps scorers and admins logged in across page refreshes on a shared
// venue tablet without needing the internet.
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setStoredUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export function shouldInvalidateSession(status, auth = true) {
  return auth && status === 401;
}

function invalidateSession() {
  setToken(null);
  setStoredUser(null);
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

async function request(path, { method = 'GET', body, auth = true, signal } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }

  if (!res.ok) {
    if (shouldInvalidateSession(res.status, auth)) invalidateSession();
    const message = (data && data.error) || `Request failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }

  return data;
}

export const api = {
  get: (path, opts) => request(path, { method: 'GET', ...opts }),
  post: (path, body, opts) => request(path, { method: 'POST', body, ...opts }),
  put: (path, body, opts) => request(path, { method: 'PUT', body, ...opts }),
  patch: (path, body, opts) => request(path, { method: 'PATCH', body, ...opts }),
  del: (path, opts) => request(path, { method: 'DELETE', ...opts }),
  public: {
    get: (path, opts) => request(path, { method: 'GET', auth: false, ...opts }),
  },
};
