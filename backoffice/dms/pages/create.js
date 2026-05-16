/* DMS - Create / Edit
 * Uses existing GAS web app via iframe to preserve full template logic + PDF generation + Drive save.
 * "ห้ามแก้ logic+template" — เปิด iframe เข้าระบบเดิม
 */
(function(){
  function buildUrl(){
    const base = BO_CONFIG.GAS_API_URL;
    let hash = '#create';
    const openDoc = sessionStorage.getItem('dms_open_doc');
    const openMode = sessionStorage.getItem('dms_open_mode');
    const qcType = sessionStorage.getItem('dms_create_type');
    if (openDoc){
      hash = '#' + (openMode === 'edit' ? 'edit' : 'editor') + '?id=' + encodeURIComponent(openDoc);
      sessionStorage.removeItem('dms_open_doc');
      sessionStorage.removeItem('dms_open_mode');
    } else if (qcType){
      hash = '#create?type=' + encodeURIComponent(qcType);
      sessionStorage.removeItem('dms_create_type');
    }
    return base + hash;
  }

  window.PAGES = window.PAGES || {};
  window.PAGES['create'] = function(root){
    const url = buildUrl();
    root.innerHTML = ''
      + '<div class="pt-content__topbar">'
      +   '<h1 class="pt-content__title"><i class="bi bi-plus-circle"></i> สร้าง / แก้ไขเอกสาร</h1>'
      +   '<a id="dcOpen" target="_blank" class="btn btn-outline-secondary btn-sm"><i class="bi bi-box-arrow-up-right"></i> เปิดหน้าต่างใหม่</a>'
      + '</div>'
      + '<div class="pt-content__body" style="padding:0;display:flex;flex-direction:column;">'
      +   '<div style="background:#FEF3C7;border-bottom:1px solid var(--line);padding:8px 14px;font-size:12px;color:#92400E;">'
      +     '<i class="bi bi-info-circle"></i> ใช้ template เดิม — login รอบแรกถ้าระบบเดิมขอ · PDF บันทึก Google Drive เหมือนเดิม'
      +   '</div>'
      +   '<iframe id="dcFrame" src="'+url+'" style="flex:1;border:0;width:100%;min-height:calc(100vh - 130px);" allow="clipboard-read; clipboard-write"></iframe>'
      + '</div>';
    root.querySelector('#dcOpen').href = url;
  };
})();
