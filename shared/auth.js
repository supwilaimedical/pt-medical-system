// PT Medical System — Auth Helper (GAS HR API)
// Requires: config.js loaded before this, supabase-js CDN

const _supabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// =============================================
// Session policy
// =============================================
// 1) Session timeout: auto-logout 8 hours after login
// 2) Force logout: admin sets settings.FORCE_LOGOUT_AFTER = <ms timestamp>
//    → any session with loginAt < FORCE_LOGOUT_AFTER is invalidated
var SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000;
var _forceLogoutAfter = 0;  // cached timestamp (ms), loaded on page init + every 5 min

// --- Session helpers ---
function getUserMeta() {
  const raw = localStorage.getItem('pt_user_meta');
  return raw ? JSON.parse(raw) : null;
}

function isLoggedIn() {
  var meta = getUserMeta();
  if (!meta) return false;
  var loginAt = meta.loginAt ? new Date(meta.loginAt).getTime() : 0;
  if (!loginAt) return false;
  // 8-hour session timeout
  if (Date.now() - loginAt > SESSION_TIMEOUT_MS) {
    localStorage.removeItem('pt_user_meta');
    return false;
  }
  // Admin-triggered force logout
  if (_forceLogoutAfter > 0 && loginAt < _forceLogoutAfter) {
    localStorage.removeItem('pt_user_meta');
    return false;
  }
  return true;
}

// Load FORCE_LOGOUT_AFTER from Supabase + evaluate current session
// Returns true if user was force-logged-out (caller may redirect)
async function refreshForceLogoutCheck() {
  if (typeof _supabase === 'undefined') return false;
  try {
    var r = await _supabase.from('settings')
      .select('value').eq('key', 'FORCE_LOGOUT_AFTER').maybeSingle();
    if (r && r.data && r.data.value) {
      _forceLogoutAfter = parseInt(r.data.value, 10) || 0;
    }
    var meta = getUserMeta();
    if (meta && _forceLogoutAfter > 0) {
      var loginAt = meta.loginAt ? new Date(meta.loginAt).getTime() : 0;
      if (loginAt && loginAt < _forceLogoutAfter) {
        localStorage.removeItem('pt_user_meta');
        return true;
      }
    }
  } catch(e) { console.warn('refreshForceLogoutCheck:', e.message || e); }
  return false;
}

// Start periodic force-logout polling (every 5 min) + run once immediately
var _forceLogoutInterval = null;
function startSessionPolicyPolling() {
  if (_forceLogoutInterval) clearInterval(_forceLogoutInterval);
  refreshForceLogoutCheck().then(function(kicked) {
    if (kicked) {
      alert('Session หมดอายุ (admin force logout) — กรุณา login ใหม่');
      window.location.href = CONFIG.BASE_URL + '/';
    }
  });
  _forceLogoutInterval = setInterval(function() {
    refreshForceLogoutCheck().then(function(kicked) {
      if (kicked) {
        alert('Session หมดอายุ (admin force logout) — กรุณา login ใหม่');
        window.location.href = CONFIG.BASE_URL + '/';
      }
    });
  }, 5 * 60 * 1000);
}

function getUserRole() {
  const meta = getUserMeta();
  return meta ? (meta.role || 'User') : 'User';
}

function getUserName() {
  const meta = getUserMeta();
  return meta ? (meta.full_name || meta.name || 'Unknown') : 'Unknown';
}

function getUserUsername() {
  const meta = getUserMeta();
  return meta ? (meta.username || '') : '';
}

// --- Login via GAS HR API ---
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('btn-login');

  if (!username || !pass) {
    if (errEl) { errEl.textContent = 'กรุณากรอก Username และ Password'; errEl.classList.remove('d-none'); }
    return;
  }

  if (errEl) { errEl.classList.add('d-none'); errEl.textContent = ''; }
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังเข้าสู่ระบบ...'; }

  try {
    const res = await fetch(CONFIG.GAS_AUTH_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ username: username, password: pass }),
      redirect: 'follow'
    });
    const result = await res.json();

    if (result.status === 'success') {
      localStorage.setItem('pt_user_meta', JSON.stringify({
        full_name: result.name || username,
        role: result.role || 'User',
        username: username,
        loginAt: new Date().toISOString()
      }));

      // Show app
      const loginView = document.getElementById('login-view');
      if (loginView) loginView.style.display = 'none';
      const wrapper = document.getElementById('app-main-wrapper');
      if (wrapper) wrapper.style.display = 'block';

      if (typeof onLoginSuccess === 'function') onLoginSuccess();
    } else {
      throw new Error(result.message || 'เข้าสู่ระบบไม่สำเร็จ');
    }
  } catch (err) {
    const msg = err.message || 'ไม่สามารถเชื่อมต่อระบบได้';
    if (errEl) { errEl.textContent = 'เข้าสู่ระบบไม่สำเร็จ: ' + msg; errEl.classList.remove('d-none'); }
  }

  if (btn) { btn.disabled = false; btn.innerHTML = 'เข้าสู่ระบบ (Login)'; }
}

// --- Logout ---
function handleLogout() {
  localStorage.removeItem('pt_user_meta');
  window.location.href = CONFIG.BASE_URL + '/';
}

// --- Auth guard (for module pages) ---
function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = CONFIG.BASE_URL + '/';
    return false;
  }
  return true;
}

// --- Check auth on page load ---
function checkAuth(onSuccess) {
  if (isLoggedIn()) {
    const loginView = document.getElementById('login-view');
    if (loginView) loginView.style.display = 'none';
    const wrapper = document.getElementById('app-main-wrapper');
    if (wrapper) wrapper.style.display = 'block';
    if (onSuccess) onSuccess();
    // Start polling for force-logout + periodic session re-check
    startSessionPolicyPolling();
  } else {
    // On module pages, redirect to root login
    const isRootPage = window.location.pathname === CONFIG.BASE_URL + '/' ||
                       window.location.pathname === CONFIG.BASE_URL + '/index.html' ||
                       window.location.pathname === '/';
    if (!isRootPage) {
      window.location.href = CONFIG.BASE_URL + '/';
    }
  }
}

// --- Escape HTML ---
function escapeHtml(text) {
  if (!text) return '';
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(text));
  return d.innerHTML;
}
