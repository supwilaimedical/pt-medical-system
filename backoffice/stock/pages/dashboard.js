/* Stock - Dashboard */
(function(){
  let typeNames = {};

  function render(root, d){
    root.querySelector('#sdTotalSkus').textContent = (d.summary.totalSkus||0).toLocaleString();
    root.querySelector('#sdTotalQty').textContent  = (d.summary.totalQty||0).toLocaleString();
    root.querySelector('#sdLowCount').textContent  = (d.summary.lowStockCount||0).toLocaleString();
    root.querySelector('#sdExpCount').textContent  = (d.summary.expiringCount||0).toLocaleString();

    const byTypeHtml = (d.byType||[]).map(t =>
      '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--line);">'
      + '<span><strong>'+boEscape(typeNames[t.type_id]||t.type_id)+'</strong> <span style="color:var(--ink-3);">('+boEscape(t.type_id)+')</span></span>'
      + '<span>'+t.count+' SKU · '+(t.qty||0).toLocaleString()+' ชิ้น</span>'
      + '</div>'
    ).join('') || '<div style="color:var(--ink-3);">ยังไม่มีข้อมูล</div>';
    root.querySelector('#sdByType').innerHTML = byTypeHtml;

    const lowHtml = (d.lowStock||[]).slice(0,50).map(s =>
      '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--line);">'
      + '<span><a href="#items" style="font-family:var(--font-mono);color:var(--primary);">'+boEscape(s.sku_code)+'</a> '+boEscape(s.name)+'</span>'
      + '<span style="color:#92400E;font-weight:600;">'+s.total_qty+'/'+s.reorder_level+'</span>'
      + '</div>'
    ).join('') || '<div style="color:var(--ink-3);">ไม่มี</div>';
    root.querySelector('#sdLowList').innerHTML = lowHtml;

    const expHtml = (d.expiringLots||[]).slice(0,50).map(l => {
      const days = Math.ceil((new Date(l.expiry_date) - new Date()) / (24*60*60*1000));
      const color = days < 30 ? '#991B1B' : (days < 60 ? '#92400E' : '#374151');
      return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--line);">'
        + '<span><span style="font-family:var(--font-mono);font-size:11px;">'+boEscape(l.lot_number||'-')+'</span> · qty '+l.qty+'</span>'
        + '<span style="color:'+color+';font-weight:600;">หมด '+boEscape(l.expiry_date)+' ('+days+' วัน)</span>'
        + '</div>';
    }).join('') || '<div style="color:var(--ink-3);">ไม่มี lot ใกล้หมด</div>';
    root.querySelector('#sdExpiring').innerHTML = expHtml;

    const mov = d.movements30d || [];
    const inSum = mov.filter(m => m.action==='IN').reduce((s,m)=> s + (Number(m.qty)||0), 0);
    const outSum = mov.filter(m => m.action==='OUT').reduce((s,m)=> s + (Number(m.qty)||0), 0);
    const adjSum = mov.filter(m => m.action==='ADJUST').length;
    root.querySelector('#sdMovStats').innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">'
      + '<div style="text-align:center;padding:10px;background:#D1FAE5;border-radius:6px;"><div style="color:#065F46;font-size:11px;">รับเข้า</div><div style="font-weight:700;font-size:20px;color:#065F46;">+'+inSum.toLocaleString()+'</div></div>'
      + '<div style="text-align:center;padding:10px;background:#FEE2E2;border-radius:6px;"><div style="color:#991B1B;font-size:11px;">เบิกออก</div><div style="font-weight:700;font-size:20px;color:#991B1B;">-'+outSum.toLocaleString()+'</div></div>'
      + '<div style="text-align:center;padding:10px;background:#DBEAFE;border-radius:6px;"><div style="color:#1E40AF;font-size:11px;">ปรับยอด</div><div style="font-weight:700;font-size:20px;color:#1E40AF;">'+adjSum+'</div></div>'
      + '</div>'
      + '<div style="margin-top:8px;color:var(--ink-3);font-size:12px;">รวม '+mov.length+' movements 30 วัน</div>';
  }

  async function load(root){
    try {
      if (!Object.keys(typeNames).length){
        const t = await boApi('stock_listTypes', {});
        (t.types||[]).forEach(x => typeNames[x.id] = x.name_th);
      }
      const r = await boApi('stock_dashboard', {});
      if (r.status !== 'success') throw new Error(r.message || 'fail');
      render(root, r);
    } catch(e){
      root.querySelector('#sdAlertBox').innerHTML =
        '<div class="alert alert-danger">โหลดไม่สำเร็จ: '+boEscape(e.message)+'</div>';
    }
  }

  window.PAGES = window.PAGES || {};
  window.PAGES['dashboard'] = function(root){
    root.innerHTML = ''
      + '<div class="pt-content__topbar">'
      +   '<h1 class="pt-content__title"><i class="bi bi-house-door"></i> Stock Dashboard</h1>'
      + '</div>'
      + '<div class="pt-content__body">'
      +   '<div id="sdAlertBox"></div>'
      +   '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:14px 0;">'
      +     '<div class="panel" style="padding:14px;"><div style="font-size:12px;color:var(--ink-3);">SKU ทั้งหมด</div><div id="sdTotalSkus" style="font-size:24px;font-weight:700;color:var(--primary);">—</div></div>'
      +     '<div class="panel" style="padding:14px;"><div style="font-size:12px;color:var(--ink-3);">จำนวนรวม</div><div id="sdTotalQty" style="font-size:24px;font-weight:700;">—</div></div>'
      +     '<div class="panel" style="padding:14px;background:#FEF3C7;"><div style="font-size:12px;color:#92400E;">ใกล้หมด</div><div id="sdLowCount" style="font-size:24px;font-weight:700;color:#92400E;">—</div></div>'
      +     '<div class="panel" style="padding:14px;background:#FEE2E2;"><div style="font-size:12px;color:#991B1B;">หมดอายุใน 90 วัน</div><div id="sdExpCount" style="font-size:24px;font-weight:700;color:#991B1B;">—</div></div>'
      +   '</div>'
      +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;" class="sd-grid">'
      +     '<div class="panel" style="padding:14px;"><div style="margin-bottom:8px;font-weight:600;">📊 แบ่งตามประเภท</div><div id="sdByType" style="font-size:13px;">—</div></div>'
      +     '<div class="panel" style="padding:14px;"><div style="margin-bottom:8px;font-weight:600;">⚠️ ของใกล้หมด</div><div id="sdLowList" style="font-size:13px;max-height:300px;overflow-y:auto;">—</div></div>'
      +   '</div>'
      +   '<div class="panel" style="padding:14px;margin-top:14px;"><div style="margin-bottom:8px;font-weight:600;">🗓 หมดอายุใน 90 วัน</div><div id="sdExpiring" style="font-size:13px;max-height:400px;overflow-y:auto;">—</div></div>'
      +   '<div class="panel" style="padding:14px;margin-top:14px;"><div style="margin-bottom:8px;font-weight:600;">📈 Movement 30 วันล่าสุด</div><div id="sdMovStats" style="font-size:13px;">—</div></div>'
      +   '<style>@media(max-width:760px){.sd-grid{grid-template-columns:1fr !important;}}</style>'
      + '</div>';
    load(root);
  };
})();
