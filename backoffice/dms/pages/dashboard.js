/* DMS - Dashboard (simplified KPI) */
(function(){
  function fmt(n){ return (Number(n)||0).toLocaleString('th-TH'); }
  function inMonth(d, y, m){ const x = new Date(d); return x.getFullYear()===y && x.getMonth()===m; }

  async function load(root){
    try {
      const r = await boApi('getDocuments', {});
      const docs = r.documents || [];
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth();
      const monthDocs = docs.filter(d => d.docDate && inMonth(d.docDate, y, m));
      const monthReceipts = monthDocs.filter(d => d.docType === 'Receipt');
      const monthTotal = monthReceipts.reduce((s,d) => s + (Number(d.grandTotal)||0), 0);
      const yearDocs = docs.filter(d => d.docDate && new Date(d.docDate).getFullYear()===y);
      const yearReceipts = yearDocs.filter(d => d.docType === 'Receipt');
      const yearTotal = yearReceipts.reduce((s,d) => s + (Number(d.grandTotal)||0), 0);

      // by type this month
      const types = ['Quotation','Invoice','BillingNote','Receipt','TaxInvoice'];
      const typeLabels = { Quotation:'ใบเสนอราคา', Invoice:'ใบแจ้งหนี้', BillingNote:'ใบวางบิล', Receipt:'ใบเสร็จ', TaxInvoice:'ใบกำกับภาษี' };
      const byType = types.map(t => ({ t, n: monthDocs.filter(d => d.docType===t).length }));

      root.querySelector('#dKpis').innerHTML =
        kpi('฿', 'green', 'ยอดรับเงินเดือนนี้', '฿' + fmt(monthTotal))
        + kpi('📄', 'navy', 'เอกสารเดือนนี้', fmt(monthDocs.length))
        + kpi('👥', 'amber', 'รวมเอกสารทั้งหมด', fmt(docs.length))
        + kpi('↻', 'purple', 'ยอดรับเงินปี '+y, '฿' + fmt(yearTotal));

      root.querySelector('#dByType').innerHTML = byType.map(x =>
        '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed var(--line);">'
        + '<span>'+boEscape(typeLabels[x.t])+'</span>'
        + '<span style="font-weight:700;">'+fmt(x.n)+'</span></div>'
      ).join('');

      // recent docs
      const recent = docs.slice().sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||'')).slice(0,10);
      root.querySelector('#dRecent').innerHTML = recent.length
        ? recent.map(d =>
            '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed var(--line);">'
            + '<span><strong>'+boEscape(d.docNumber||'-')+'</strong> '+boEscape(typeLabels[d.docType]||d.docType||'')+' · '+boEscape(d.customerName||'-')+'</span>'
            + '<span style="color:var(--ink-3);font-size:12px;">'+boEscape((d.docDate||'').slice(0,10))+'</span>'
            + '</div>'
          ).join('')
        : '<div style="color:var(--ink-3);padding:10px;">ยังไม่มีเอกสาร</div>';
    } catch(e){
      root.innerHTML = '<div class="pt-content__body"><div class="alert alert-danger">โหลดผิดพลาด: '+boEscape(e.message)+'</div></div>';
    }
  }

  function kpi(icon, color, label, value){
    const bg = { green:'#10b981', navy:'#1A2B4A', amber:'#f59e0b', purple:'#8b5cf6' }[color] || '#64748b';
    return '<div class="panel" style="padding:16px;">'
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">'
      +   '<div style="width:36px;height:36px;border-radius:8px;background:'+bg+';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;">'+icon+'</div>'
      +   '<div style="font-size:12px;color:var(--ink-3);">'+boEscape(label)+'</div>'
      + '</div>'
      + '<div style="font-size:22px;font-weight:700;color:var(--primary);">'+value+'</div>'
      + '</div>';
  }

  window.PAGES = window.PAGES || {};
  window.PAGES['dashboard'] = function(root){
    root.innerHTML = ''
      + '<div class="pt-content__topbar">'
      +   '<h1 class="pt-content__title"><i class="bi bi-house-door"></i> DMS Dashboard</h1>'
      +   '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
      +     '<button class="btn btn-outline-secondary btn-sm" data-qc="Quotation">+ Q</button>'
      +     '<button class="btn btn-outline-secondary btn-sm" data-qc="Invoice">+ INV</button>'
      +     '<button class="btn btn-outline-secondary btn-sm" data-qc="BillingNote">+ BL</button>'
      +     '<button class="btn btn-danger btn-sm" data-qc="Receipt">+ Receipt</button>'
      +     '<button class="btn btn-outline-secondary btn-sm" data-qc="TaxInvoice">+ Tax</button>'
      +   '</div>'
      + '</div>'
      + '<div class="pt-content__body">'
      +   '<div id="dKpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px;"></div>'
      +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;" class="dms-grid">'
      +     '<div class="panel" style="padding:14px;"><div style="margin-bottom:10px;font-weight:600;">📊 เอกสารเดือนนี้ (ตามประเภท)</div><div id="dByType" style="font-size:13px;">—</div></div>'
      +     '<div class="panel" style="padding:14px;"><div style="margin-bottom:10px;font-weight:600;">🕒 เอกสารล่าสุด</div><div id="dRecent" style="font-size:13px;max-height:340px;overflow-y:auto;">—</div></div>'
      +   '</div>'
      +   '<style>@media(max-width:760px){.dms-grid{grid-template-columns:1fr !important;}}</style>'
      + '</div>';
    root.querySelectorAll('[data-qc]').forEach(b => b.onclick = () => {
      sessionStorage.setItem('dms_create_type', b.dataset.qc);
      location.hash = 'create';
    });
    load(root);
  };
})();
