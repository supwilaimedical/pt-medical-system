/* Stock - Movement History */
(function(){
  let movs = [], skus = [], entries = [], locs = [], sublocs = [];

  function render(root){
    const q = (root.querySelector('#hstSearch').value||'').trim().toLowerCase();
    const actFilter = root.querySelector('#hstAction').value;
    const userFilter = root.querySelector('#hstUser').value;
    const eMap = {}; entries.forEach(e => { eMap[e.id] = e; });
    const sMap = {}; skus.forEach(s => { sMap[s.sku_code] = s; });
    const lMap = {}; locs.forEach(l => { lMap[l.id] = l; });
    const subMap = {}; sublocs.forEach(s => { subMap[s.id] = s; });

    let rows = movs.map(m => {
      const ent = eMap[m.entry_id] || {};
      const sku = sMap[ent.sku_code] || {};
      return Object.assign({}, m, {
        sku_code: ent.sku_code || '-',
        sku_name: sku.name || '-',
        loc_name: (lMap[ent.loc_id] && lMap[ent.loc_id].name) || '-',
        sub_name: (subMap[ent.subloc_id] && subMap[ent.subloc_id].name) || '-'
      });
    });
    if (actFilter) rows = rows.filter(r => r.action === actFilter);
    if (userFilter) rows = rows.filter(r => r.by_user === userFilter);
    if (q) rows = rows.filter(r =>
      ((r.sku_code+' '+r.sku_name+' '+(r.reason||'')+' '+(r.by_user||'')).toLowerCase().indexOf(q) !== -1)
    );

    root.querySelector('#hstCount').textContent = rows.length + ' รายการ';
    const body = root.querySelector('#hstBody');
    if (!rows.length){
      body.innerHTML = '<tr><td colspan="8" style="padding:30px;text-align:center;color:var(--ink-3);">— ไม่มี —</td></tr>';
      return;
    }
    body.innerHTML = rows.map(r => {
      const ts = new Date(r.created_at).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'});
      const actIcon = r.action==='IN' ? '📥' : r.action==='OUT' ? '📤' : '⚙️';
      const actColor = r.action==='IN' ? '#065F46' : r.action==='OUT' ? '#991B1B' : '#92400E';
      const qtySign = r.action==='IN' ? '+' : r.action==='OUT' ? '-' : (r.qty>=0?'+':'');
      return '<tr style="border-top:1px solid var(--line);">'
        + '<td style="padding:8px;color:var(--ink-3);font-size:11px;white-space:nowrap;">'+boEscape(ts)+'</td>'
        + '<td style="padding:8px;color:'+actColor+';">'+actIcon+' '+boEscape(r.action)+'</td>'
        + '<td style="padding:8px;font-family:var(--font-mono);font-weight:600;">'+boEscape(r.sku_code)+'</td>'
        + '<td style="padding:8px;">'+boEscape(r.sku_name)+'</td>'
        + '<td style="padding:8px;font-size:11px;color:var(--ink-3);">'+boEscape(r.loc_name)+' / '+boEscape(r.sub_name)+'</td>'
        + '<td style="padding:8px;text-align:right;font-weight:700;color:'+actColor+';">'+qtySign+Math.abs(r.qty)+'</td>'
        + '<td style="padding:8px;font-family:var(--font-mono);font-size:12px;">'+boEscape(r.by_user||'-')+'</td>'
        + '<td style="padding:8px;color:var(--ink-3);font-size:12px;">'+boEscape(r.reason||'-')+'</td>'
        + '</tr>';
    }).join('');
  }

  async function reload(root){
    const body = root.querySelector('#hstBody');
    body.innerHTML = '<tr><td colspan="8" style="padding:30px;text-align:center;color:var(--ink-3);">กำลังโหลด...</td></tr>';
    try {
      const since = root.querySelector('#hstSince').value;
      const sinceIso = since ? since + 'T00:00:00' : '';
      const [m, s, e, l, sub] = await Promise.all([
        boApi('stock_listMovements', { filter: { since: sinceIso, limit: 5000 } }),
        boApi('stock_listSkus', { filter: { limit: 5000 } }),
        boApi('stock_listEntries', { filter: { limit: 20000 } }),
        boApi('stock_listLocations', {}),
        boApi('stock_listSublocs', {}).catch(()=>({sublocs:[]}))
      ]);
      movs = m.movements || [];
      skus = s.skus || [];
      entries = e.entries || [];
      locs = l.locations || [];
      sublocs = sub.sublocs || [];

      const users = [...new Set(movs.map(x => x.by_user).filter(Boolean))].sort();
      const uSel = root.querySelector('#hstUser');
      const cur = uSel.value;
      uSel.innerHTML = '<option value="">— ทุกคน —</option>' + users.map(u =>
        '<option value="'+boEscape(u)+'">'+boEscape(u)+'</option>'
      ).join('');
      if (cur && users.includes(cur)) uSel.value = cur;
      render(root);
    } catch(err){
      body.innerHTML = '<tr><td colspan="8" style="padding:20px;color:var(--danger);">โหลดผิดพลาด: '+boEscape(err.message)+'</td></tr>';
    }
  }

  function exportCsv(root){
    const rows = [['เวลา','Action','SKU','ชื่อของ','ที่เก็บ','QTY','ผู้ทำ','เหตุผล']];
    const eMap = {}; entries.forEach(e => { eMap[e.id] = e; });
    const sMap = {}; skus.forEach(s => { sMap[s.sku_code] = s; });
    const lMap = {}; locs.forEach(l => { lMap[l.id] = l; });
    const subMap = {}; sublocs.forEach(s => { subMap[s.id] = s; });
    movs.forEach(m => {
      const ent = eMap[m.entry_id] || {};
      const sku = sMap[ent.sku_code] || {};
      rows.push([
        m.created_at,
        m.action,
        ent.sku_code||'-',
        sku.name||'-',
        ((lMap[ent.loc_id]||{}).name||'-')+'/'+((subMap[ent.subloc_id]||{}).name||'-'),
        m.qty,
        m.by_user||'-',
        m.reason||''
      ]);
    });
    const csv = rows.map(r => r.map(v =>
      '"' + String(v==null?'':v).replace(/"/g,'""') + '"'
    ).join(',')).join('\n');
    const blob = new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'stock_movements_'+(new Date().toISOString().slice(0,10))+'.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  window.PAGES = window.PAGES || {};
  window.PAGES['history'] = function(root){
    root.innerHTML = ''
      + '<div class="pt-content__topbar">'
      +   '<h1 class="pt-content__title"><i class="bi bi-clock-history"></i> ประวัติเคลื่อนไหว Stock</h1>'
      + '</div>'
      + '<div class="pt-content__body">'
      +   '<div class="panel panel--filter mb-3">'
      +     '<div class="panel__body" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">'
      +       '<input id="hstSearch" class="form-control" type="search" placeholder="ค้น SKU / ชื่อ / เหตุผล..." style="flex:1;min-width:200px;">'
      +       '<select id="hstAction" class="form-select" style="width:auto;"><option value="">— ทุก action —</option><option value="IN">📥 รับเข้า</option><option value="OUT">📤 เบิก</option><option value="ADJUST">⚙️ ปรับ</option></select>'
      +       '<select id="hstUser" class="form-select" style="width:auto;"><option value="">— ทุกคน —</option></select>'
      +       '<input id="hstSince" type="date" class="form-control" style="width:auto;">'
      +       '<button id="hstReload" class="btn btn-outline-secondary"><i class="bi bi-arrow-clockwise"></i></button>'
      +       '<button id="hstExport" class="btn btn-outline-secondary"><i class="bi bi-download"></i> CSV</button>'
      +       '<span id="hstCount" class="text-muted" style="font-size:12px;">—</span>'
      +     '</div>'
      +   '</div>'
      +   '<div class="panel">'
      +     '<div class="panel__body" style="padding:0;overflow-x:auto;">'
      +       '<table class="table table-sm mb-0" style="font-size:13px;">'
      +         '<thead style="background:var(--bg-soft);"><tr>'
      +           '<th>เวลา</th><th>Action</th><th>SKU</th><th>ชื่อของ</th><th>ที่เก็บ</th><th style="text-align:right;">QTY</th><th>ผู้ทำ</th><th>เหตุผล</th>'
      +         '</tr></thead>'
      +         '<tbody id="hstBody"><tr><td colspan="8" style="padding:30px;text-align:center;color:var(--ink-3);">กำลังโหลด...</td></tr></tbody>'
      +       '</table>'
      +     '</div>'
      +   '</div>'
      + '</div>';

    // Default since: 7 วันย้อน
    const d = new Date(); d.setDate(d.getDate()-7);
    root.querySelector('#hstSince').value = d.toISOString().slice(0,10);

    root.querySelector('#hstSearch').addEventListener('input', () => render(root));
    root.querySelector('#hstAction').addEventListener('change', () => render(root));
    root.querySelector('#hstUser').addEventListener('change', () => render(root));
    root.querySelector('#hstSince').addEventListener('change', () => reload(root));
    root.querySelector('#hstReload').addEventListener('click', () => reload(root));
    root.querySelector('#hstExport').addEventListener('click', () => exportCsv(root));

    reload(root);
  };
})();
