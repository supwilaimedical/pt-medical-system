/* DMS - Settings — iframe legacy GAS settings (preserve full template + audit + backup logic) */
(function(){
  window.PAGES = window.PAGES || {};
  window.PAGES['settings'] = function(root){
    const url = BO_CONFIG.GAS_API_URL + '#settings';
    root.innerHTML = ''
      + '<div class="pt-content__topbar">'
      +   '<h1 class="pt-content__title"><i class="bi bi-gear"></i> ตั้งค่า</h1>'
      +   '<a href="'+url+'" target="_blank" class="btn btn-outline-secondary btn-sm"><i class="bi bi-box-arrow-up-right"></i> เปิดหน้าต่างใหม่</a>'
      + '</div>'
      + '<div class="pt-content__body" style="padding:0;display:flex;flex-direction:column;">'
      +   '<div style="background:#FEF3C7;border-bottom:1px solid var(--line);padding:8px 14px;font-size:12px;color:#92400E;">'
      +     '<i class="bi bi-info-circle"></i> ใช้หน้าตั้งค่าเดิม — login รอบแรกถ้าระบบเดิมขอ'
      +   '</div>'
      +   '<iframe src="'+url+'" style="flex:1;border:0;width:100%;min-height:calc(100vh - 130px);"></iframe>'
      + '</div>';
  };
})();
