// Backoffice (DMS + Stock) — Auth (GAS HR API)
// Same endpoint as PT-Amb; separate localStorage key.

function boGetUserMeta() {
  const raw = localStorage.getItem(BO_CONFIG.SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

function boIsLoggedIn() {
  const m = boGetUserMeta();
  if (!m) return false;
  const t = m.loginAt ? new Date(m.loginAt).getTime() : 0;
  if (!t) return false;
  if (Date.now() - t > BO_CONFIG.SESSION_TIMEOUT_MS) {
    localStorage.removeItem(BO_CONFIG.SESSION_KEY);
    return false;
  }
  return true;
}

function boGetUser()      { const m = boGetUserMeta(); return m ? (m.username || '') : ''; }
function boGetUserName()  { const m = boGetUserMeta(); return m ? (m.full_name || m.name || '') : ''; }
function boGetUserRole()  { const m = boGetUserMeta(); return m ? (m.role || 'User') : 'User'; }
function boUserInitials() {
  const n = boGetUserName() || boGetUser() || '';
  return n.split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase() || '?';
}

async function boLogin(username, password) {
  const res = await fetch(BO_CONFIG.GAS_AUTH_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ username, password }),
    redirect: 'follow'
  });
  const r = await res.json();
  if (r.status !== 'success') throw new Error(r.message || 'login failed');
  localStorage.setItem(BO_CONFIG.SESSION_KEY, JSON.stringify({
    full_name: r.name || username,
    role: r.role || 'User',
    username,
    loginAt: new Date().toISOString()
  }));
  return r;
}

function boLogout() {
  localStorage.removeItem(BO_CONFIG.SESSION_KEY);
  location.href = BO_CONFIG.BASE_URL + '/';
}

function boRequireAuth() {
  if (!boIsLoggedIn()) {
    location.href = BO_CONFIG.BASE_URL + '/';
    return false;
  }
  return true;
}

// Common HTML escape
function boEscape(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(s)));
  return d.innerHTML;
}
