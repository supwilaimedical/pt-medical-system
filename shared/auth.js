// PT Medical System — Auth Helper
// Requires: supabase-js CDN + config.js loaded before this

const _supabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// --- Session helpers ---
function getSession() {
  return _supabase.auth.getSession();
}

async function isLoggedIn() {
  const { data } = await _supabase.auth.getSession();
  return !!data.session;
}

function getUserMeta() {
  const raw = localStorage.getItem('pt_user_meta');
  return raw ? JSON.parse(raw) : {};
}

function getUserRole() {
  return getUserMeta().role || 'User';
}

function getUserName() {
  return getUserMeta().full_name || 'Unknown';
}

// --- Login ---
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('btn-login');

  if (errEl) { errEl.classList.add('d-none'); errEl.textContent = ''; }
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังเข้าสู่ระบบ...'; }

  // Allow login with just username (append @supwilai.com)
  const loginEmail = email.includes('@') ? email : email + '@supwilai.com';

  const { data, error } = await _supabase.auth.signInWithPassword({ email: loginEmail, password: pass });

  if (error) {
    if (errEl) { errEl.textContent = 'เข้าสู่ระบบไม่สำเร็จ: ' + error.message; errEl.classList.remove('d-none'); }
    if (btn) { btn.disabled = false; btn.innerHTML = 'เข้าสู่ระบบ (Login)'; }
    return;
  }

  // Save user metadata
  const meta = data.user.user_metadata || {};
  localStorage.setItem('pt_user_meta', JSON.stringify(meta));

  // Show app
  document.getElementById('login-view').style.display = 'none';
  const wrapper = document.getElementById('app-main-wrapper');
  if (wrapper) wrapper.style.display = 'block';

  if (typeof onLoginSuccess === 'function') onLoginSuccess();
}

// --- Logout ---
async function handleLogout() {
  await _supabase.auth.signOut();
  localStorage.removeItem('pt_user_meta');
  window.location.reload();
}

// --- Auto-login check ---
async function checkAuth(onSuccess) {
  const { data } = await _supabase.auth.getSession();
  if (data.session) {
    const meta = data.session.user.user_metadata || {};
    localStorage.setItem('pt_user_meta', JSON.stringify(meta));
    document.getElementById('login-view').style.display = 'none';
    const wrapper = document.getElementById('app-main-wrapper');
    if (wrapper) wrapper.style.display = 'block';
    if (onSuccess) onSuccess();
  }
}

// --- Escape HTML ---
function escapeHtml(text) {
  if (!text) return '';
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(text));
  return d.innerHTML;
}
