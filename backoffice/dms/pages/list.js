/* DMS - Document List (mobile kebab fixed via Bootstrap dropdown) */
(function(){
  let docs = [];
  const LABELS = { Quotation:'ใบเสนอราคา', Invoice:'ใบแจ้งหนี้', BillingNote:'ใบวางบิล', Receipt:'ใบเสร็จ', TaxInvoice:'ใบกำกับภาษี' };
  const COLORS = { Quotation:'#3b82f6', Invoice:'#f59e0b', BillingNote:'#8b5cf6', Receipt:'#10b981', TaxInvoice:'#ef4444' };

  function render(root){
    const q = (root.querySelector('#lstSearch').value||'').toLowerCase().trim();
    const tf = root.querySelector('#lstType').value;
    let rows = docs.slice();
    if (tf) rows = rows.filter(d => d.docType === tf);
    if (q) rows = rows.filter(d =>
      ((d.docNumber||'')+' '+(d.customerName||'')+' '+(d.notes||'')).toLowerCase().indexOf(q) !== -1
    );
    rows.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    root.querySelector('#lstCount').textContent = rows.length + ' รายการ';
    const body = root.querySelector('#lstBody');
    if (!rows.length){
      body.innerHTML = '<tr><td colspan="6" style="padding:30px;text-align:center;color:var(--ink-3);">— ไม่มีเอกสาร —</td></tr>';
      return;
    }
    body.innerHTML = rows.map(d => {
      const c = COLORS[d.docType] || '#64748b';
      const label = LABELS[d.docType] || d.docType || '';
      return '<tr style="border-top:1px solid var(--line);">'
        + '<td style="padding:8px;"><span style="display:inline-block;padding:2px 8px;border-radius:4px;background:'+c+';color:#fff;font-size:11px;font-weight:600;">'+boEscape(label)+'</span></td>'
        + '<td style="padding:8px;font-family:var(--font-mono);font-weight:600;">'+boEscape(d.docNumber||'-')+'</td>'
        + '<td style="padding:8px;">'+boEscape(d.customerName||'-')+'</td>'
        + '<td style="padding:8px;text-align:right;font-weight:600;">'+boFmt.money(d.grandTotal)+'</td>'
        + '<td style="padding:8px;color:var(--ink-3);font-size:12px;">'+boEscape((d.docDate||'').slice(0,10))+'</td>'
        + '<td style="padding:8px;text-align:right;">'
        +   '<div class="dropdown">'
        +     '<button class="btn btn-sm btn-light" data-bs-toggle="dropdown" aria-expanded="false"><i class="bi bi-three-dots"></i></button>'
        +     '<ul class="dropdown-menu dropdown-menu-end">'
        +       '<li><button class="dropdown-item" data-act="view" data-id="'+boEscape(d.docId)+'"><i class="bi bi-eye me-2"></i>ดู / Print</button></li>'
        +       '<li><button class="dropdown-item" data-act="edit" data-id="'+boEscape(d.docId)+'"><i class="bi bi-pencil me-2"></i>แก้ไข</button></li>'
        +       '<li><button class="dropdown-item" data-act="pdf" data-id="'+boEscape(d.docId)+'"><i class="bi bi-file-pdf me-2"></i>PDF</button></li>'
        +       '<li><hr class="dropdown-divider"></li>'
        +       '<li><button class="dropdown-item text-danger" data-act="del" data-id="'+boEscape(d.docId)+'"><i class="bi bi-trash me-2"></i>ลบ</button></li>'
        +     '</ul>'
        +   '</div>'
        + '</td>'
        + '</tr>';
    }).join('');
  }

  async function reload(root){
    const body = root.querySelector('#lstBody');
    body.innerHTML = '<tr><td colspan="6" style="padding:30px;text-align:center;color:var(--ink-3);">กำลังโหลด...</td></tr>';
    try {
      const r = await boApi('getDocuments', {});
      docs = r.documents || [];
      render(root);
    } catch(e){
      body.innerHTML = '<tr><td colspan="6" style="padding:20px;color:var(--danger);">โหลดผิดพลาด: '+boEscape(e.message)+'</td></tr>';
    }
  }

  async function action(root, act, id){
    if (act === 'view' || act === 'edit'){
      sessionStorage.setItem('dms_open_doc', id);
      sessionStorage.setItem('dms_open_mode', act);
      location.hash = 'create';
      return;
    }
    if (act === 'pdf'){
      try {
        const r = await boApi('getDocPdf', { docId: id });
        if (r.pdfUrl){
          window.open(r.pdfUrl, '_blank');
        } else {
          boToast('ยังไม่มี PDF — เปิดเอกสารแล้วกด Print เพื่อสร้าง PDF', 'undo');
        }
      } catch(e){ boToast('โหลด PDF ผิดพลาด: '+e.message, 'err'); }
      return;
    }
    if (act === 'del'){
      const ok = await boConfirm('ลบเอกสารนี้?', 'การลบไม่สามารถย้อนได้');
      if (!ok) return;
      try {
        await boApi('deleteDocument', { docId: id });
        boToast('ลบแล้ว', 'ok');
        reload(root);
      } catch(e){ boToast('ลบผิดพลาด: '+e.message, 'err'); }
    }
  }

  window.PAGES = window.PAGES || {};
  window.PAGES['list'] = function(root){
    root.innerHTML = ''
      + '<div class="pt-content__topbar">'
      +   '<h1 class="pt-content__title"><i class="bi bi-list-ul"></i> รายการเอกสาร</h1>'
      +   '<button id="lstNew" class="btn btn-primary btn-sm"><i class="bi bi-plus-lg"></i> สร้างใหม่</button>'
      + '</div>'
      + '<div class="pt-content__body">'
      +   '<div class="panel panel--filter mb-3"><div class="panel__body" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">'
      +     '<input id="lstSearch" type="search" class="form-control" placeholder="ค้นเลขเอกสาร / ลูกค้า / หมายเหตุ..." style="flex:1;min-width:200px;">'
      +     '<select id="lstType" class="form-select" style="width:auto;">'
      +       '<option value="">— ทุกประเภท —</option>'
      +       '<option value="Quotation">ใบเสนอราคา</option>'
      +       '<option value="Invoice">ใบแจ้งหนี้</option>'
      +       '<option value="BillingNote">ใบวางบิล</option>'
      +       '<option value="Receipt">ใบเสร็จ</option>'
      +       '<option value="TaxInvoice">ใบกำกับภาษี</option>'
      +     '</select>'
      +     '<button id="lstReload" class="btn btn-outline-secondary"><i class="bi bi-arrow-clockwise"></i></button>'
      +     '<span id="lstCount" class="text-muted" style="font-size:12px;">—</span>'
      +   '</div></div>'
      +   '<div class="panel"><div class="panel__body" style="padding:0;overflow-x:auto;">'
      +     '<table class="table table-sm mb-0" style="font-size:13px;">'
      +       '<thead style="background:var(--bg-soft);"><tr><th>ประเภท</th><th>เลขที่</th><th>ลูกค้า</th><th style="text-align:right;">ยอดรวม</th><th>วันที่</th><th></th></tr></thead>'
      +       '<tbody id="lstBody"><tr><td colspan="6" style="padding:30px;text-align:center;color:var(--ink-3);">กำลังโหลด...</td></tr></tbody>'
      +     '</table>'
      +   '</div></div>'
      + '</div>';

    root.querySelector('#lstSearch').addEventListener('input', () => render(root));
    root.querySelector('#lstType').addEventListener('change', () => render(root));
    root.querySelector('#lstReload').addEventListener('click', () => reload(root));
    root.querySelector('#lstNew').addEventListener('click', () => { location.hash = 'create'; });
    root.querySelector('#lstBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn) action(root, btn.dataset.act, btn.dataset.id);
    });
    reload(root);
  };
})();
