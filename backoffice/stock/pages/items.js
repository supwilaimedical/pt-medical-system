/* Stock — Items list (vanilla, calls GAS endpoints unchanged) */
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

  let state = {
    items: [], entryMap: {}, locs: [], sublocs: [], types: [],
    type: 'all', search: '', lowOnly: false, view: 'flat', selected: new Set()
  };

  async function load() {
    boLoading(true, 'กำลังโหลดรายการสินค้า...');
    try {
      const [skusRes, entRes, locsRes, subsRes, typesRes] = await Promise.all([
        boApi('stock_listSkus',     { filter: { limit: 5000 } }),
        boApi('stock_listEntries',  { filter: { limit: 20000 } }),
        boApi('stock_listLocations', {}),
        boApi('stock_listSublocs',   {}),
        boApi('stock_listTypes',     {})
      ]);
      state.items = (skusRes.skus || []).map(s => ({
        ...s,
        _key: ((s.sku_code||'') + ' ' + (s.name||'')).toLowerCase()
      }));
      state.entryMap = {};
      (entRes.entries || []).forEach(e => {
        (state.entryMap[e.sku_code] = state.entryMap[e.sku_code] || []).push(e);
      });
      state.locs    = locsRes.locations || [];
      state.sublocs = subsRes.sublocs   || [];
      state.types   = typesRes.types    || [];
    } catch (e) {
      boToast('โหลดผิดพลาด: ' + e.message, 'err');
    } finally {
      boLoading(false);
    }
  }

  function filtered() {
    let rows = state.items.slice();
    if (state.type !== 'all') rows = rows.filter(r => r.type_id === state.type);
    if (state.lowOnly) rows = rows.filter(r => Number(r.reorder_level)>0 && Number(r.total_qty) <= Number(r.reorder_level));
    if (state.search) {
      const q = state.search.toLowerCase();
      rows = rows.filter(r => r._key.indexOf(q) !== -1);
    }
    return rows;
  }

  function rowHTML(s) {
    const t = TYPE_INFO[s.type_id] || { emoji:'📋', label:s.type_id||'-', chip:'gen' };
    const qty = Number(s.total_qty)||0;
    const low = Number(s.reorder_level)>0 && qty <= Number(s.reorder_level);
    const ents = state.entryMap[s.sku_code] || [];
    const loc1 = ents[0];
    const locText = loc1
      ? `${locName(loc1.loc_id)}/${subName(loc1.subloc_id)||'-'}${ents.length>1?` +${ents.length-1}`:''}`
      : '<span style="color:var(--ink-4)">ไม่ระบุที่เก็บ</span>';
    return `
      <div class="sk-row sk-row--${t.chip}" data-sku="${boEscape(s.sku_code)}" data-act="open">
        <div class="sk-row__rail"></div>
        <div class="sk-row__thumb">${t.emoji}</div>
        <div class="sk-row__main">
          <div class="sk-row__sku mono">${boEscape(s.sku_code)}</div>
          <div class="sk-row__name">${boEscape(s.name||'')} ${s.has_expiry?'<span class="chip chip--warn chip--sm"><i class="bi bi-hourglass-split"></i> มี exp</span>':''}</div>
          <div class="sk-row__meta">
            <span class="chip chip--${t.chip} chip--sm">${t.emoji} ${t.label}</span>
            <span style="color:var(--ink-4);font-size:11px;">${locText}</span>
            ${low?'<span class="chip chip--danger chip--sm"><i class="bi bi-exclamation-triangle"></i> ใกล้หมด</span>':''}
          </div>
        </div>
        <span></span>
        <div class="sk-row__qty ${low?'sk-row__qty--low':''}"><b>${boFmt.num(qty)}</b><span>${boEscape(s.unit||'-')}</span></div>
        <button class="sk-row__kebab" data-act="kebab" data-sku="${boEscape(s.sku_code)}"><i class="bi bi-three-dots-vertical"></i></button>
      </div>`;
  }

  function locName(id){ const l = state.locs.find(x=>x.id===id); return l?l.name:id; }
  function subName(id){ const s = state.sublocs.find(x=>x.id===id); return s?s.name:''; }

  function render(root) {
    const rows = filtered();
    const lowCount = state.items.filter(r => Number(r.reorder_level)>0 && Number(r.total_qty)<=Number(r.reorder_level)).length;

    root.innerHTML = `
      <div class="pt-content__topbar">
        <h1 class="pt-content__title">รายการสินค้า</h1>
        <span class="chip chip--ghost" id="cnt">${rows.length} / ${state.items.length} SKU</span>
        <div class="spacer" style="flex:1;"></div>
        <button class="btn btn-light btn-sm" id="btnSticker"><i class="bi bi-tag me-1"></i> พิมพ์สติ๊กเกอร์</button>
        <button class="btn btn-primary btn-sm" id="btnAdd"><i class="bi bi-plus-lg me-1"></i> เพิ่มสินค้า</button>
      </div>
      <div class="pt-content__body">
        <div class="filter-bar mb-3">
          <div class="seg flex-wrap">
            <button class="seg__btn ${state.type==='all'?'is-active':''}" data-type="all">ทั้งหมด</button>
            ${Object.entries(TYPE_INFO).map(([k,v]) =>
              `<button class="seg__btn ${state.type===k?'is-active':''}" data-type="${k}">${v.emoji} ${v.label}</button>`
            ).join('')}
          </div>
          <input id="srch" class="form-control form-control-sm" placeholder="🔍 ค้นจาก รหัส / ชื่อ ..." value="${boEscape(state.search)}" style="max-width:280px;">
          <button class="btn btn-sm ${state.lowOnly?'btn-danger':'btn-outline-danger'}" id="btnLow">
            <i class="bi bi-exclamation-triangle"></i> ใกล้หมด ${lowCount>0?`(${lowCount})`:''}
          </button>
        </div>

        <div id="listBody">
          ${rows.length === 0
            ? '<div class="state state--empty" style="padding:60px;text-align:center;color:var(--ink-3);"><i class="bi bi-inbox" style="font-size:48px;"></i><div style="margin-top:12px;">ไม่พบรายการ</div></div>'
            : rows.map(rowHTML).join('')}
        </div>
      </div>
    `;

    // Wire
    root.querySelector('#srch').addEventListener('input', (e) => {
      state.search = e.target.value;
      const list = root.querySelector('#listBody');
      const r = filtered();
      list.innerHTML = r.length ? r.map(rowHTML).join('') : '<div style="padding:40px;text-align:center;color:var(--ink-3);">ไม่พบ</div>';
      root.querySelector('#cnt').textContent = r.length + ' / ' + state.items.length + ' SKU';
    });
    root.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { state.type = b.dataset.type; render(root); });
    root.querySelector('#btnLow').onclick = () => { state.lowOnly = !state.lowOnly; render(root); };
    root.querySelector('#btnAdd').onclick = openAddModal;
    root.querySelector('#btnSticker').onclick = () => { location.hash = 'sticker'; };

    root.querySelectorAll('.sk-row').forEach(row => {
      row.addEventListener('click', (e) => {
        const code = row.dataset.sku;
        if (e.target.closest('[data-act="kebab"]')) {
          openSkuMenu(code, e.target.closest('button'));
          return;
        }
        openDetail(code);
      });
    });
  }

  function openSkuMenu(code, anchor) {
    const sku = state.items.find(s => s.sku_code === code);
    if (!sku) return;
    // Use Bootstrap dropdown — render once on body
    const id = 'mnu_' + Date.now();
    const html = `
      <ul class="dropdown-menu show" id="${id}" style="position:fixed;z-index:11000;">
        <li><button class="dropdown-item" data-mnu="detail"><i class="bi bi-eye me-2"></i>ดูรายละเอียด</button></li>
        <li><button class="dropdown-item" data-mnu="edit"><i class="bi bi-pencil me-2"></i>แก้ไข SKU</button></li>
        <li><button class="dropdown-item" data-mnu="sticker"><i class="bi bi-tag me-2"></i>พิมพ์สติ๊กเกอร์</button></li>
        <li><hr class="dropdown-divider"></li>
        <li><button class="dropdown-item text-danger" data-mnu="delete"><i class="bi bi-trash me-2"></i>ลบ SKU</button></li>
      </ul>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const el = document.getElementById(id);
    const r = anchor.getBoundingClientRect();
    el.style.top = (r.bottom + 4) + 'px';
    el.style.left = Math.max(8, r.right - 200) + 'px';
    const close = () => { el.remove(); document.removeEventListener('click', outside); };
    const outside = (ev) => { if (!el.contains(ev.target)) close(); };
    setTimeout(() => document.addEventListener('click', outside), 0);
    el.querySelectorAll('[data-mnu]').forEach(b => b.onclick = () => {
      const a = b.dataset.mnu;
      close();
      if (a === 'detail') openDetail(code);
      if (a === 'edit') openEditModal(code);
      if (a === 'sticker') { sessionStorage.setItem('stkPayload', JSON.stringify({mode:'b1', sku_code:code})); location.hash='sticker'; }
      if (a === 'delete') deleteSku(code);
    });
  }

  async function openDetail(code) {
    try {
      boLoading(true, 'กำลังโหลด...');
      const r = await boApi('stock_getSku', { sku_code: code });
      boLoading(false);
      if (r.status !== 'success') throw new Error(r.message);
      const s = r.sku;
      const ents = r.entries || [];
      const lots = r.lots || [];
      const html = `
        <div class="modal fade" id="sDtl" tabindex="-1">
          <div class="modal-dialog modal-dialog-centered modal-lg">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">🔍 ${boEscape(s.sku_code)}</h5>
                <button class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                <div class="row g-3 mb-3">
                  <div class="col-sm-6"><strong>ชื่อ:</strong> ${boEscape(s.name||'')}</div>
                  <div class="col-sm-6"><strong>หน่วย:</strong> ${boEscape(s.unit||'-')}</div>
                  <div class="col-sm-6"><strong>ประเภท:</strong> ${boEscape(s.type_id||'')}</div>
                  <div class="col-sm-6"><strong>หมดอายุ:</strong> ${s.has_expiry?'ใช่':'ไม่'}</div>
                  <div class="col-sm-6"><strong>Reorder:</strong> ${boFmt.num(s.reorder_level)}</div>
                  <div class="col-sm-6"><strong>QR:</strong> <code>${boEscape(s.qr_payload||s.sku_code)}</code></div>
                </div>
                <h6>📍 ที่เก็บ (entries)</h6>
                ${ents.length? `<table class="table table-sm"><thead><tr><th>พื้นที่</th><th>ชั้น/กล่อง</th><th class="text-end">QTY</th></tr></thead><tbody>${
                  ents.map(e => `<tr><td>${boEscape(locName(e.loc_id))}</td><td>${boEscape(e.subloc_name||subName(e.subloc_id)||'-')}</td><td class="text-end fw-bold">${boFmt.num(e.qty)}</td></tr>`).join('')
                }</tbody></table>` : '<div class="text-muted">ยังไม่ระบุที่เก็บ</div>'}
                ${s.has_expiry && lots.length ? `<h6 class="mt-3">📅 Lots</h6><table class="table table-sm"><thead><tr><th>Lot#</th><th>รับเข้า</th><th>หมดอายุ</th><th class="text-end">QTY</th></tr></thead><tbody>${
                  lots.map(l => `<tr><td><code>${boEscape(l.lot_number||'-')}</code></td><td>${boEscape(l.import_date||'-')}</td><td>${boEscape(l.expiry_date||'-')}</td><td class="text-end fw-bold">${boFmt.num(l.qty)}</td></tr>`).join('')
                }</tbody></table>` : ''}
              </div>
              <div class="modal-footer">
                <button class="btn btn-light" data-bs-dismiss="modal">ปิด</button>
                <button class="btn btn-primary" id="sDtlEdit"><i class="bi bi-pencil me-1"></i> แก้ไข</button>
              </div>
            </div>
          </div>
        </div>`;
      document.body.insertAdjacentHTML('beforeend', html);
      const m = new bootstrap.Modal(document.getElementById('sDtl'));
      document.getElementById('sDtlEdit').onclick = () => { m.hide(); openEditModal(code); };
      document.getElementById('sDtl').addEventListener('hidden.bs.modal', () => document.getElementById('sDtl').remove());
      m.show();
    } catch (e) {
      boLoading(false);
      boToast('โหลดผิดพลาด: ' + e.message, 'err');
    }
  }

  function openAddModal()  { openEditModal(null); }
  function openEditModal(code) {
    const cached = code ? state.items.find(s => s.sku_code === code) : null;
    const isEdit = !!cached;
    const typeOpts = state.types.map(t =>
      `<option value="${boEscape(t.id)}" ${cached && cached.type_id===t.id?'selected':''}>${boEscape(t.name_th)} (${boEscape(t.id)})</option>`
    ).join('');
    const locOpts = '<option value="">— ไม่ระบุ —</option>' + state.locs.map(l =>
      `<option value="${boEscape(l.id)}">${boEscape(l.id+' - '+l.name)}</option>`
    ).join('');
    const html = `
      <div class="modal fade" id="sEdt" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">${isEdit?'✏️ แก้ไข '+boEscape(code):'+ เพิ่มสินค้า'}</h5>
              <button class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <div class="row g-3">
                <div class="col-sm-8"><label class="form-label">ชื่อสินค้า *</label><input id="iName" class="form-control" value="${boEscape(cached?cached.name:'')}"></div>
                <div class="col-sm-4"><label class="form-label">หน่วย</label><input id="iUnit" class="form-control" value="${boEscape(cached?cached.unit:'')}" placeholder="ชิ้น/ขวด/ฯลฯ"></div>
                <div class="col-sm-8"><label class="form-label">ประเภท *</label><select id="iType" class="form-select">${typeOpts}</select></div>
                <div class="col-sm-4"><label class="form-label">Reorder level</label><input id="iReorder" type="number" min="0" class="form-control" value="${cached?cached.reorder_level:0}"></div>
                <div class="col-12"><div class="form-check"><input id="iExp" class="form-check-input" type="checkbox" ${cached&&cached.has_expiry?'checked':''}><label class="form-check-label">มีวันหมดอายุ (track lot)</label></div></div>
                <div class="col-12"><label class="form-label">รายละเอียด</label><textarea id="iDetail" class="form-control" rows="2">${boEscape(cached?cached.detail:'')}</textarea></div>
                ${!isEdit ? `
                <div class="col-12"><hr><div class="text-muted small">📍 ตำแหน่งเก็บ + จำนวนเริ่มต้น (optional)</div></div>
                <div class="col-sm-5"><label class="form-label">LOC</label><select id="iLoc" class="form-select">${locOpts}</select></div>
                <div class="col-sm-5"><label class="form-label">Sub-LOC</label><select id="iSubloc" class="form-select" disabled><option value="">— เลือก LOC ก่อน —</option></select></div>
                <div class="col-sm-2"><label class="form-label">QTY</label><input id="iQty" type="number" min="0" class="form-control" value="0"></div>
                ` : ''}
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-light" data-bs-dismiss="modal">ยกเลิก</button>
              <button class="btn btn-primary" id="iSave">บันทึก</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const m = new bootstrap.Modal(document.getElementById('sEdt'));
    document.getElementById('sEdt').addEventListener('hidden.bs.modal', () => document.getElementById('sEdt').remove());

    // Sub-LOC cascading (Add mode)
    if (!isEdit) {
      document.getElementById('iLoc').onchange = (e) => {
        const sub = document.getElementById('iSubloc');
        const locId = e.target.value;
        if (!locId) { sub.innerHTML = '<option value="">— เลือก LOC ก่อน —</option>'; sub.disabled = true; return; }
        const subs = state.sublocs.filter(s => s.loc_id === locId);
        sub.innerHTML = '<option value="">— เลือก —</option>' + subs.map(s => `<option value="${boEscape(s.id)}">${boEscape(s.name)}</option>`).join('');
        sub.disabled = false;
      };
    }

    document.getElementById('iSave').onclick = async () => {
      const name = document.getElementById('iName').value.trim();
      if (!name) { boToast('กรอกชื่อสินค้า', 'err'); return; }
      const newType = document.getElementById('iType').value;
      const payload = {
        sku_code: code || undefined,
        name,
        unit: document.getElementById('iUnit').value.trim() || null,
        type_id: newType,
        has_expiry: document.getElementById('iExp').checked,
        reorder_level: Number(document.getElementById('iReorder').value) || 0,
        detail: document.getElementById('iDetail').value.trim() || null
      };
      if (!isEdit) {
        payload.loc_id    = document.getElementById('iLoc').value || null;
        payload.subloc_id = document.getElementById('iSubloc').value || null;
        payload.initial_qty = Number(document.getElementById('iQty').value) || 0;
      }
      // Type change → backend auto-renames (atomic via SQL RPC)
      try {
        boLoading(true, isEdit?'กำลังบันทึก...':'กำลังเพิ่มสินค้า...');
        const r = await boApi('stock_saveSku', { sku: payload });
        boLoading(false);
        m.hide();
        if (r.renamed_from) boToast(`บันทึก + เปลี่ยนรหัส: ${r.renamed_from} → ${r.sku_code}`, 'ok');
        else boToast(isEdit?'บันทึกแล้ว':'เพิ่มสินค้าแล้ว: '+r.sku_code, 'ok');
        await load();
        render(document.getElementById('content'));
      } catch (e) {
        boLoading(false);
        boToast('ผิดพลาด: ' + e.message, 'err');
      }
    };
    m.show();
    setTimeout(() => document.getElementById('iName').focus(), 200);
  }

  async function deleteSku(code) {
    const ok = await boConfirm(`ลบ ${code}? (ลบไม่ได้ถ้ายังมี qty > 0)`, { ok:'ลบ', danger:true });
    if (!ok) return;
    try {
      boLoading(true, 'กำลังลบ...');
      await boApi('stock_deleteSku', { sku_code: code });
      boLoading(false);
      boToast('ลบสำเร็จ', 'ok');
      await load();
      render(document.getElementById('content'));
    } catch (e) {
      boLoading(false);
      boToast('ลบไม่ได้: ' + e.message, 'err');
    }
  }

  window.PAGES['items'] = async function(root) {
    if (!state.items.length) await load();
    render(root);
  };
})();
