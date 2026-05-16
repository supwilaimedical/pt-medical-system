/* DMS - Customers (read + edit + delete) */
(function(){
  let custs = [];
  let editId = null;

  function render(root){
    const q = (root.querySelector('#cmFilter').value||'').toLowerCase().trim();
    let rows = custs.slice();
    if (q) rows = rows.filter(c =>
      ((c.name||'')+' '+(c.tel||'')+' '+(c.tax_id||'')+' '+(c.address||'')).toLowerCase().indexOf(q) !== -1
    );
    rows.sort((a,b) => (a.name||'').localeCompare(b.name||''));
    root.querySelector('#cmCount').textContent = rows.length + ' รายการ';
    const body = root.querySelector('#cmBody');
    if (!rows.length){
      body.innerHTML = '<tr><td colspan="6" style="padding:30px;text-align:center;color:var(--ink-3);">— ไม่มีลูกค้า —</td></tr>';
      return;
    }
    body.innerHTML = rows.map(c =>
      '<tr style="border-top:1px solid var(--line);">'
      + '<td style="padding:8px;font-weight:600;">'+boEscape(c.name||'-')+'</td>'
      + '<td style="padding:8px;">'+boEscape(c.tel||'-')+'</td>'
      + '<td style="padding:8px;font-family:var(--font-mono);font-size:12px;">'+boEscape(c.tax_id||'-')+'</td>'
      + '<td style="padding:8px;color:var(--ink-3);font-size:12px;">'+boEscape(c.address||'-')+'</td>'
      + '<td style="padding:8px;text-align:center;">'+(c.doc_count||0)+'</td>'
      + '<td style="padding:8px;text-align:right;">'
      +   '<button class="btn btn-sm btn-light me-1" data-act="edit" data-id="'+boEscape(c.id)+'"><i class="bi bi-pencil"></i></button>'
      +   '<button class="btn btn-sm btn-light text-danger" data-act="del" data-id="'+boEscape(c.id)+'"><i class="bi bi-trash"></i></button>'
      + '</td>'
      + '</tr>'
    ).join('');
  }

  async function reload(root){
    root.querySelector('#cmBody').innerHTML = '<tr><td colspan="6" style="padding:30px;text-align:center;color:var(--ink-3);">กำลังโหลด...</td></tr>';
    try {
      const r = await boApi('listCustomers', { limit: 5000 });
      custs = r.customers || [];
      render(root);
    } catch(e){
      root.querySelector('#cmBody').innerHTML = '<tr><td colspan="6" style="padding:20px;color:var(--danger);">โหลดผิดพลาด: '+boEscape(e.message)+'</td></tr>';
    }
  }

  function openEdit(root, id){
    const c = custs.find(x => String(x.id) === String(id));
    if (!c) return;
    editId = id;
    root.querySelector('#cmEditName').value = c.name||'';
    root.querySelector('#cmEditTel').value  = c.tel||'';
    root.querySelector('#cmEditTax').value  = c.tax_id||'';
    root.querySelector('#cmEditAddr').value = c.address||'';
    const modal = new bootstrap.Modal(root.querySelector('#cmEditModal'));
    modal.show();
    root._cmModal = modal;
  }

  async function saveEdit(root){
    if (!editId) return;
    const customer = {
      name:    root.querySelector('#cmEditName').value.trim(),
      tel:     root.querySelector('#cmEditTel').value.trim(),
      tax_id:  root.querySelector('#cmEditTax').value.trim(),
      address: root.querySelector('#cmEditAddr').value.trim()
    };
    try {
      await boApi('updateCustomer', { id: editId, customer });
      boToast('บันทึกแล้ว', 'ok');
      root._cmModal && root._cmModal.hide();
      reload(root);
    } catch(e){ boToast('บันทึกผิดพลาด: '+e.message, 'err'); }
  }

  async function del(root, id){
    const ok = await boConfirm('ลบลูกค้านี้?', 'ลูกค้าที่ผูกกับเอกสารจะลบไม่ได้');
    if (!ok) return;
    try {
      await boApi('deleteCustomer', { id });
      boToast('ลบแล้ว', 'ok');
      reload(root);
    } catch(e){ boToast('ลบผิดพลาด: '+e.message, 'err'); }
  }

  window.PAGES = window.PAGES || {};
  window.PAGES['customers'] = function(root){
    root.innerHTML = ''
      + '<div class="pt-content__topbar">'
      +   '<h1 class="pt-content__title"><i class="bi bi-people"></i> จัดการลูกค้า</h1>'
      + '</div>'
      + '<div class="pt-content__body">'
      +   '<div class="panel panel--filter mb-3"><div class="panel__body" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">'
      +     '<input id="cmFilter" type="search" class="form-control" placeholder="ค้นชื่อ / เบอร์ / เลขภาษี..." style="flex:1;min-width:200px;">'
      +     '<button id="cmReload" class="btn btn-outline-secondary"><i class="bi bi-arrow-clockwise"></i></button>'
      +     '<span id="cmCount" class="text-muted" style="font-size:12px;">—</span>'
      +   '</div></div>'
      +   '<div class="panel"><div class="panel__body" style="padding:0;overflow-x:auto;">'
      +     '<table class="table table-sm mb-0" style="font-size:13px;">'
      +       '<thead style="background:var(--bg-soft);"><tr><th>ชื่อ</th><th>เบอร์</th><th>เลขภาษี</th><th>ที่อยู่</th><th style="text-align:center;">เอกสาร</th><th></th></tr></thead>'
      +       '<tbody id="cmBody"><tr><td colspan="6" style="padding:30px;text-align:center;color:var(--ink-3);">กำลังโหลด...</td></tr></tbody>'
      +     '</table>'
      +   '</div></div>'
      +   '<div class="modal fade" id="cmEditModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content">'
      +     '<div class="modal-header"><h5 class="modal-title">แก้ไขข้อมูลลูกค้า</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>'
      +     '<div class="modal-body">'
      +       '<div class="mb-2"><label class="form-label">ชื่อ</label><input id="cmEditName" class="form-control"></div>'
      +       '<div class="mb-2"><label class="form-label">เบอร์โทร</label><input id="cmEditTel" class="form-control"></div>'
      +       '<div class="mb-2"><label class="form-label">เลขผู้เสียภาษี</label><input id="cmEditTax" class="form-control"></div>'
      +       '<div class="mb-2"><label class="form-label">ที่อยู่</label><textarea id="cmEditAddr" class="form-control" rows="2"></textarea></div>'
      +     '</div>'
      +     '<div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">ยกเลิก</button><button id="cmSaveBtn" class="btn btn-primary">บันทึก</button></div>'
      +   '</div></div></div>'
      + '</div>';

    root.querySelector('#cmFilter').addEventListener('input', () => render(root));
    root.querySelector('#cmReload').addEventListener('click', () => reload(root));
    root.querySelector('#cmSaveBtn').addEventListener('click', () => saveEdit(root));
    root.querySelector('#cmBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'edit') openEdit(root, btn.dataset.id);
      if (btn.dataset.act === 'del') del(root, btn.dataset.id);
    });
    reload(root);
  };
})();
