// Backoffice — API helper
// Forwards every action to existing GAS web app endpoint (unchanged backend).
// Server-side auto-resolves user/userRole from request; we inject session here.

async function boApi(action, payload = {}) {
  const meta = boGetUserMeta() || {};
  const body = Object.assign({
    action,
    user: meta.username || '',
    userRole: meta.role || ''
  }, payload);

  let res;
  try {
    res = await fetch(BO_CONFIG.GAS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    });
  } catch (e) {
    throw new Error('Network: ' + (e.message || 'fetch failed'));
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  let r;
  try { r = await res.json(); }
  catch (e) { throw new Error('Bad JSON response'); }
  if (r && r.status === 'fail') throw new Error(r.message || 'fail');
  return r;
}

// Toast (lightweight)
function boToast(msg, kind = 'ok', opts = {}) {
  const host = document.getElementById('boToastHost') || (() => {
    const d = document.createElement('div');
    d.id = 'boToastHost';
    d.className = 'bo-toast-host';
    document.body.appendChild(d);
    return d;
  })();
  const el = document.createElement('div');
  el.className = 'bo-toast bo-toast--' + kind;
  const icon = kind === 'err' ? 'exclamation-triangle' : (kind === 'undo' ? 'arrow-counterclockwise' : 'check-circle');
  el.innerHTML = `<i class="bi bi-${icon}"></i><span>${boEscape(msg)}</span>` +
                 (opts.action ? `<button class="bo-toast__btn">${boEscape(opts.action)}</button>` : '');
  host.appendChild(el);
  if (opts.action && opts.onAction) {
    el.querySelector('.bo-toast__btn').onclick = () => { opts.onAction(); el.remove(); };
  }
  setTimeout(() => el.remove(), opts.duration || 4000);
}

// Modal helpers (Bootstrap)
function boConfirm(msg, opts = {}) {
  return new Promise((resolve) => {
    const id = 'boConfirm_' + Date.now();
    const html = `
      <div class="modal fade" id="${id}" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header"><h5 class="modal-title">${boEscape(opts.title || 'ยืนยัน')}</h5></div>
            <div class="modal-body" style="white-space:pre-wrap;">${boEscape(msg)}</div>
            <div class="modal-footer">
              <button class="btn btn-light" data-bs-dismiss="modal">${boEscape(opts.cancel || 'ยกเลิก')}</button>
              <button class="btn ${opts.danger?'btn-danger':'btn-primary'}" id="${id}_ok">${boEscape(opts.ok || 'ตกลง')}</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const el = document.getElementById(id);
    const m = new bootstrap.Modal(el);
    let chosen = false;
    el.querySelector('#' + id + '_ok').onclick = () => { chosen = true; m.hide(); };
    el.addEventListener('hidden.bs.modal', () => {
      resolve(chosen);
      el.remove();
    });
    m.show();
  });
}

// Loading overlay
function boLoading(show, text = 'กำลังบันทึก...') {
  let el = document.getElementById('boLoadOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'boLoadOverlay';
    el.className = 'bo-load-overlay';
    el.innerHTML = `<div class="bo-load-card"><div class="spinner-border text-primary"></div><div class="bo-load-text"></div></div>`;
    document.body.appendChild(el);
  }
  el.querySelector('.bo-load-text').textContent = text || '';
  el.classList.toggle('is-open', !!show);
}

// Format helpers
const boFmt = {
  money: n => Number(n||0).toLocaleString('th-TH', { minimumFractionDigits:2, maximumFractionDigits:2 }),
  num:   n => Number(n||0).toLocaleString('th-TH'),
  date:  s => { try { return new Date(s).toLocaleDateString('th-TH', { year:'numeric', month:'short', day:'numeric' }); } catch(_) { return s; } },
  short: s => { try { return new Date(s).toLocaleDateString('th-TH', { month:'short', day:'numeric' }); } catch(_) { return s; } },
  time:  s => { try { return new Date(s).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' }); } catch(_) { return s; } }
};
