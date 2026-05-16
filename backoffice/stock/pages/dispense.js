/* Stock — Dispense (camera scan + atomic dispense) */
(function(){
  window.PAGES = window.PAGES || {};

  const TYPE_INFO = {
    'PH':{emoji:'💊', label:'ยา',          chip:'drug'},
    'MD':{emoji:'🩹', label:'เวชภัณฑ์',    chip:'med'},
    'EQ':{emoji:'🩺', label:'อุปกรณ์การแพทย์', chip:'equip'},
    'CN':{emoji:'📦', label:'ของใช้ทั่วไป', chip:'gen'},
    'DC':{emoji:'📄', label:'เอกสาร',      chip:'doc'},
    'TL':{emoji:'🔧', label:'อุปกรณ์ช่าง',  chip:'tech'},
    'OX':{emoji:'🫁', label:'ออกซิเจน',    chip:'ox'}
  };

  let state = { skus: [], entries: [], lots: [], locs: [], sublocs: [], recent: [] };
  let scanner = null;

  async function load() {
    boLoading(true, 'กำลังโหลด...');
    try {
      const [s, e, l, sub, lots] = await Promise.all([
        boApi('stock_listSkus',     { filter:{ limit:5000 } }),
        boApi('stock_listEntries',  { filter:{ limit:20000 } }),
        boApi('stock_listLocations', {}),
        boApi('stock_listSublocs',   {}),
        boApi('stock_listLots',     { filter:{ limit:20000 } })
      ]);
      state.skus = (s.skus||[]).map(x => ({ ...x, _key:((x.sku_code||'')+' '+(x.name||'')).toLowerCase() }));
      state.entries = e.entries || [];
      state.locs    = l.locations || [];
      state.sublocs = sub.sublocs || [];
      state.lots    = lots.lots || [];
      await loadRecent();
    } catch (ex) {
      boToast('โหลดผิดพลาด: ' + ex.message, 'err');
    } finally {
      boLoading(false);
    }
  }
  async function loadRecent() {
    try {
      const today = new Date().toISOString().slice(0,10);
      const r = await boApi('stock_listMovements', { filter:{ by_user: boGetUser(), action:'OUT', since: today+'T00:00:00', limit: 30 } });
      const movs = r.movements || [];
      const byEntry = {};
      state.entries.forEach(e => byEntry[e.id] = e.sku_code);
      state.recent = movs.slice(0,8).map(m => ({
        time: boFmt.time(m.created_at),
        sku: byEntry[m.entry_id] || '?',
        qty: m.qty,
        reason: m.reason || ''
      }));
    } catch(_) { state.recent = []; }
  }
  function locName(id){ const l = state.locs.find(x=>x.id===id); return l?l.name:id; }
  function subName(id){ const s = state.sublocs.find(x=>x.id===id); return s?s.name:''; }

  function render(root) {
    root.innerHTML = `
      <div class="pt-content__topbar">
        <h1 class="pt-content__title">เบิกของ</h1>
        <span class="chip chip--ghost" id="dCount">—</span>
        <div class="spacer" style="flex:1;"></div>
      </div>
      <div class="pt-content__body">
        <!-- Scan input (sticky) -->
        <div class="d-flex gap-2 mb-3" style="position:sticky;top:56px;background:var(--bg);z-index:5;padding-bottom:8px;">
          <button class="btn btn-light" id="btnCam" title="เปิดกล้องสแกน QR"><i class="bi bi-camera-video"></i></button>
          <input id="scanInput" class="form-control mono" placeholder="📷 Scan / พิมพ์รหัส SKU แล้วกด Enter" style="font-size:16px;font-weight:600;flex:1;">
          <span class="badge bg-primary align-self-center px-2 py-2">Enter</span>
        </div>

        <!-- Camera box (hidden until activated) -->
        <div id="camBox" style="display:none;background:#000;border-radius:12px;overflow:hidden;margin-bottom:12px;position:relative;">
          <div id="camReader" style="width:100%;max-width:400px;margin:0 auto;"></div>
          <button class="btn btn-light btn-sm" id="camClose" style="position:absolute;top:8px;right:8px;z-index:10;">✕ ปิดกล้อง</button>
          <div id="camStatus" style="background:rgba(0,0,0,.7);color:#fff;padding:8px;text-align:center;font-size:12px;"></div>
        </div>

        <!-- Recent bar -->
        ${state.recent.length ? `
        <div class="card mb-3" style="background:#fefce8;border-color:#fcd34d;">
          <div class="card__body" style="padding:8px 14px;">
            <div style="font-size:11px;font-weight:600;color:#92400E;margin-bottom:6px;">🕒 เบิกวันนี้ของฉัน (${state.recent.length})</div>
            <div class="d-flex flex-wrap gap-2">
              ${state.recent.map(r => `<span class="chip chip--warn"><span class="mono">${boEscape(r.sku)}</span> ×${r.qty} <span style="opacity:.7;">· ${r.time}</span></span>`).join('')}
            </div>
          </div>
        </div>` : ''}

        <!-- Search + filter -->
        <div class="filter-bar mb-3">
          <input id="srch" class="form-control form-control-sm" placeholder="🔍 ค้นจากชื่อสินค้า ..." style="max-width:280px;">
        </div>

        <div id="listBody"></div>
      </div>
    `;

    // Render list
    renderList(root);

    // Wire
    const scanInput = root.querySelector('#scanInput');
    scanInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { resolveCode(scanInput.value.trim()); scanInput.value = ''; }
    });
    setTimeout(() => scanInput.focus(), 100);

    root.querySelector('#btnCam').onclick = () => toggleCam(root);
    root.querySelector('#camClose').onclick = () => stopCam(root);

    root.querySelector('#srch').addEventListener('input', () => renderList(root));
  }

  function renderList(root) {
    const q = (root.querySelector('#srch').value||'').trim().toLowerCase();
    const list = q ? state.skus.filter(s => s._key.indexOf(q)!==-1) : state.skus.slice();
    list.sort((a,b) => Number(b.total_qty||0)>0 - Number(a.total_qty||0)>0);
    const top = list.slice(0, 50);
    root.querySelector('#dCount').textContent = `${list.length} SKU`;
    root.querySelector('#listBody').innerHTML = top.map(s => {
      const t = TYPE_INFO[s.type_id] || { emoji:'📋', label:'-', chip:'gen' };
      const qty = Number(s.total_qty)||0;
      const hasStock = qty > 0;
      return `<div class="sk-row sk-row--${t.chip}" data-sku="${boEscape(s.sku_code)}" style="${hasStock?'':'opacity:.55;'}">
        <div class="sk-row__rail"></div>
        <div class="sk-row__thumb">${t.emoji}</div>
        <div class="sk-row__main">
          <div class="sk-row__sku mono">${boEscape(s.sku_code)}</div>
          <div class="sk-row__name">${boEscape(s.name||'')} ${s.has_expiry?'<span style="color:#D97706;">⏱</span>':''}</div>
          <div class="sk-row__meta">
            <span class="chip chip--${t.chip} chip--sm">${t.emoji} ${t.label}</span>
          </div>
        </div>
        <span></span>
        <div class="sk-row__qty"><b>${boFmt.num(qty)}</b><span>${boEscape(s.unit||'-')}</span></div>
        <span></span>
      </div>`;
    }).join('');
    root.querySelectorAll('.sk-row').forEach(r => r.onclick = () => openDispenseModal(r.dataset.sku));
  }

  function resolveCode(code) {
    if (!code) return;
    const c = code.trim();
    const sku = state.skus.find(s => s.sku_code === c || s.qr_payload === c);
    if (!sku) { boToast('ไม่พบ SKU: ' + c, 'err'); return; }
    openDispenseModal(sku.sku_code);
  }

  function toggleCam(root) {
    const box = root.querySelector('#camBox');
    if (box.style.display === 'none') { startCam(root); }
    else { stopCam(root); }
  }
  function startCam(root) {
    const box = root.querySelector('#camBox');
    const status = root.querySelector('#camStatus');
    box.style.display = 'block';
    status.textContent = 'กำลังเปิดกล้อง...';
    if (typeof Html5Qrcode === 'undefined') { status.textContent = '❌ Library ไม่โหลด'; return; }
    try {
      scanner = new Html5Qrcode('camReader');
      scanner.start({ facingMode:'environment' }, { fps:10, qrbox:{ width:240, height:240 } }, (decoded) => {
        status.textContent = '✓ ' + decoded;
        stopCam(root);
        resolveCode(decoded);
      }, () => {}).then(() => { status.textContent = '📷 เล็งไปที่ QR Code'; })
       .catch(err => { status.textContent = '❌ เปิดกล้องไม่ได้: ' + (err.message||err); });
    } catch (e) { status.textContent = '❌ ' + e.message; }
  }
  function stopCam(root) {
    const box = root.querySelector('#camBox');
    if (scanner) {
      try { scanner.stop().catch(()=>{}).finally(() => { try{scanner.clear();}catch(_){}; scanner=null; }); } catch(_){}
    }
    box.style.display = 'none';
  }

  // ============ Dispense modal ============
  function openDispenseModal(code) {
    const sku = state.skus.find(s => s.sku_code === code);
    if (!sku) return;
    const ents = state.entries.filter(e => e.sku_code === code && Number(e.qty)>0);
    if (!ents.length) { boToast('ของหมด — ไม่มี entry ที่มีของ', 'err'); return; }

    let selEntryIdx = 0;
    let qty = 1;
    let lotMode = 'fifo';
    let manualPicks = {};

    const renderEntryCards = () => ents.map((e, i) => `
      <button class="card text-start ${i===selEntryIdx?'border-primary':''}" data-eidx="${i}" style="padding:10px 12px;${i===selEntryIdx?'background:#EEF2FF;border-width:2px;':''}">
        <div style="font-weight:600;color:#1E40AF;">📍 ${boEscape(locName(e.loc_id))}</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px;">${boEscape(subName(e.subloc_id)||'-')}</div>
        <div style="font-size:12px;color:#065F46;margin-top:4px;text-align:right;font-weight:500;"><b>${boFmt.num(e.qty)}</b> ${boEscape(sku.unit||'')}</div>
      </button>
    `).join('');

    const getLotsForEntry = (entry) => {
      return state.lots
        .filter(L => L.entry_id === entry.id && Number(L.qty) > 0)
        .sort((a,b) => (a.expiry_date||'9999-12-31').localeCompare(b.expiry_date||'9999-12-31'));
    };
    const fmtExpStatus = (date) => {
      if (!date) return { cls:'', label:'no exp' };
      const d = Math.floor((new Date(date) - new Date(new Date().toDateString())) / 86400000);
      if (d < 0)  return { cls:'exp--bad', label:`หมดอายุแล้ว ${-d} วัน` };
      if (d<=30)  return { cls:'exp--warn', label:`อีก ${d} วัน` };
      return { cls:'exp--ok', label:`อีก ${d} วัน` };
    };
    const renderLotSection = () => {
      if (!sku.has_expiry) return '';
      const entry = ents[selEntryIdx];
      const lots = getLotsForEntry(entry);
      if (!lots.length) return '<div class="alert alert-warning small">ไม่มี lot ที่มีของ</div>';

      if (lotMode === 'fifo') {
        let rem = qty, picks = [];
        for (const l of lots) {
          if (rem<=0) break;
          const take = Math.min(rem, Number(l.qty));
          picks.push({ l, take }); rem -= take;
        }
        if (rem>0) return `<div class="alert alert-danger small">⚠️ Lot รวมไม่พอ — ขาด ${rem}</div>`;
        const earliest = fmtExpStatus(lots[0].expiry_date);
        return `<div style="background:#FEFCE8;border:1px solid #FCD34D;border-radius:6px;padding:10px;">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <strong style="font-size:12px;">📦 Lot ที่จะเบิก (FIFO)</strong>
            <button class="btn btn-sm btn-outline-primary" id="btnLotManual">🎯 เลือก lot เอง</button>
          </div>
          <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">📅 ใกล้หมดสุด: <span class="exp ${earliest.cls}">${boFmt.date(lots[0].expiry_date)} · ${earliest.label}</span></div>
          ${picks.map(p => {
            const st = fmtExpStatus(p.l.expiry_date);
            return `<div style="display:flex;justify-content:space-between;padding:4px 8px;background:#fff;border-radius:4px;margin-bottom:3px;">
              <span><b class="mono">${boEscape(p.l.lot_number||'(no lot)')}</b> <span class="exp ${st.cls}">${boFmt.date(p.l.expiry_date)}</span></span>
              <span><b>${p.take}</b>/${p.l.qty}</span>
            </div>`;
          }).join('')}
        </div>`;
      } else {
        // Manual mode
        const total = Object.values(manualPicks).reduce((s,n)=>s+Number(n||0),0);
        const diff = qty - total;
        return `<div style="border:1px solid var(--line);border-radius:6px;padding:10px;">
          <div class="d-flex justify-content-between mb-2">
            <strong style="font-size:12px;">🎯 เลือก lot เอง</strong>
            <button class="btn btn-sm btn-outline-secondary" id="btnLotFifo">⚡ Auto FIFO</button>
          </div>
          <div class="alert ${diff===0?'alert-success':'alert-warning'} py-1 small mb-2">
            รวมเลือก ${total} / ต้องการ ${qty} ${diff===0?'✓':(diff>0?`ขาด ${diff}`:`เกิน ${-diff}`)}
          </div>
          ${lots.map(l => {
            const st = fmtExpStatus(l.expiry_date);
            const cur = Number(manualPicks[l.id]||0);
            return `<div class="d-flex align-items-center gap-2 mb-2">
              <div class="flex-grow-1">
                <div><b class="mono">${boEscape(l.lot_number||'(no lot)')}</b> <span class="exp ${st.cls} ms-1">${boFmt.date(l.expiry_date)} · ${st.label}</span></div>
                <div style="font-size:11px;color:#6b7280;">มี ${l.qty}</div>
              </div>
              <input type="number" min="0" max="${l.qty}" value="${cur}" data-lotid="${boEscape(l.id)}" class="form-control form-control-sm" style="width:80px;">
            </div>`;
          }).join('')}
        </div>`;
      }
    };

    const renderModal = () => `
      <div class="modal fade" id="dM" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered" style="max-width:520px;">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">📤 เบิก <span class="mono">${boEscape(code)}</span></h5>
              <button class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <div style="background:#F8FAFC;padding:10px;border-radius:6px;margin-bottom:12px;font-size:13px;">
                <strong>${boEscape(sku.name||'')}</strong><br>
                <span style="color:var(--ink-3);">หน่วย: ${boEscape(sku.unit||'-')} · คงเหลือรวม: ${boFmt.num(sku.total_qty)}${sku.has_expiry?' · <span style="color:#D97706;">⏱ มี exp</span>':''}</span>
              </div>
              <label class="form-label">เบิกจาก (ที่เก็บ)</label>
              <div class="d-flex flex-wrap gap-2 mb-3" id="entryCards">${renderEntryCards()}</div>
              <label class="form-label">จำนวน *</label>
              <input id="dQty" type="number" min="1" value="${qty}" class="form-control text-center" style="font-size:18px;font-weight:600;">
              <div id="lotSection" class="mt-3">${renderLotSection()}</div>
              <label class="form-label mt-3">เหตุผล / Case (optional)</label>
              <input id="dReason" class="form-control" placeholder="เช่น Case ID, ใช้กับคนไข้">
            </div>
            <div class="modal-footer">
              <button class="btn btn-light" data-bs-dismiss="modal">ยกเลิก</button>
              <button class="btn btn-primary" id="dSubmit">📤 เบิก</button>
            </div>
          </div>
        </div>
      </div>`;

    document.body.insertAdjacentHTML('beforeend', renderModal());
    const root = document.getElementById('dM');
    const modal = new bootstrap.Modal(root);
    root.addEventListener('hidden.bs.modal', () => root.remove());

    const wire = () => {
      root.querySelectorAll('[data-eidx]').forEach(b => b.onclick = () => {
        selEntryIdx = Number(b.dataset.eidx);
        manualPicks = {};
        root.querySelector('#entryCards').innerHTML = renderEntryCards();
        root.querySelector('#lotSection').innerHTML = renderLotSection();
        wire();
      });
      root.querySelector('#dQty').oninput = (e) => {
        qty = Math.max(1, Number(e.target.value)||1);
        root.querySelector('#lotSection').innerHTML = renderLotSection();
        wire();
      };
      const btnM = root.querySelector('#btnLotManual');
      if (btnM) btnM.onclick = () => {
        lotMode = 'manual';
        manualPicks = {};
        // pre-fill from FIFO
        const entry = ents[selEntryIdx];
        const lots = getLotsForEntry(entry);
        let rem = qty;
        for (const l of lots) {
          if (rem<=0) break;
          const take = Math.min(rem, Number(l.qty));
          manualPicks[l.id] = take;
          rem -= take;
        }
        root.querySelector('#lotSection').innerHTML = renderLotSection();
        wire();
      };
      const btnF = root.querySelector('#btnLotFifo');
      if (btnF) btnF.onclick = () => { lotMode = 'fifo'; manualPicks = {}; root.querySelector('#lotSection').innerHTML = renderLotSection(); wire(); };
      root.querySelectorAll('[data-lotid]').forEach(i => i.oninput = (e) => {
        const v = Number(e.target.value)||0;
        if (v <= 0) delete manualPicks[e.target.dataset.lotid];
        else manualPicks[e.target.dataset.lotid] = v;
        root.querySelector('#lotSection').innerHTML = renderLotSection();
        wire();
      });
    };
    wire();

    root.querySelector('#dSubmit').onclick = async () => {
      const entry = ents[selEntryIdx];
      const maxQty = Number(entry.qty);
      if (qty < 1) { boToast('จำนวนต้อง > 0', 'err'); return; }
      if (qty > maxQty) { boToast(`จำนวนเกิน — มี ${maxQty}`, 'err'); return; }
      const reason = root.querySelector('#dReason').value.trim();
      const payload = {
        sku_code: code, loc_id: entry.loc_id, subloc_id: entry.subloc_id,
        qty, reason: reason || 'web dispense'
      };
      if (sku.has_expiry && lotMode === 'manual') {
        const picks = Object.keys(manualPicks).map(id => ({lot_id:id, qty:Number(manualPicks[id])})).filter(p=>p.qty>0);
        const total = picks.reduce((s,p)=>s+p.qty,0);
        if (!picks.length) { boToast('เลือก lot อย่างน้อย 1', 'err'); return; }
        if (total !== qty) { boToast(`ผลรวม lot (${total}) ไม่เท่า qty (${qty})`, 'err'); return; }
        payload.lot_picks = picks;
      }
      try {
        boLoading(true, 'กำลังเบิก...');
        const r = await boApi('stock_dispense', { payload });
        boLoading(false);
        modal.hide();
        let msg = `เบิก ${qty} ${sku.unit||''} · เหลือ ${r.remaining_qty}`;
        if (r.lots && r.lots.length) msg += '\n' + r.lots.map(l => `Lot ${l.lot_number||'-'} ×${l.qty}`).join(', ');
        boToast(msg, 'ok');
        await load();
        render(document.getElementById('content'));
      } catch (e) {
        boLoading(false);
        boToast('เบิกไม่ได้: ' + e.message, 'err');
      }
    };
    modal.show();
    setTimeout(() => root.querySelector('#dQty').focus(), 200);
  }

  window.PAGES['dispense'] = async function(root) {
    await load();
    render(root);
  };
})();
