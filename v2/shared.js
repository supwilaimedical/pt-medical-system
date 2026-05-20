// PT Medical V2 — Shared Utilities
// Drawer, kebab, navigation, smart print, auto-save indicator

(function(){
  'use strict';

  // ============ DRAWER (Mobile) ============
  window.toggleDrawer = function(id){
    id = id || 'drawer';
    var d = document.getElementById(id);
    var b = document.getElementById(id + '-backdrop');
    if(d) d.classList.toggle('open');
    if(b) b.classList.toggle('open');
  };

  window.closeDrawer = function(id){
    id = id || 'drawer';
    var d = document.getElementById(id);
    var b = document.getElementById(id + '-backdrop');
    if(d) d.classList.remove('open');
    if(b) b.classList.remove('open');
  };

  // ============ COL NAV (Desktop) collapse/expand ============
  window.toggleNav = function(){
    var n = document.querySelector('.col-nav');
    if(n) n.classList.toggle('expanded');
  };

  // ============ KEBAB MENU ============
  window.kebab = function(e, id){
    e.stopPropagation();
    document.querySelectorAll('.kebab-menu.open').forEach(function(m){
      if(m.id !== id) m.classList.remove('open');
    });
    var el = document.getElementById(id);
    if(el) el.classList.toggle('open');
  };

  document.addEventListener('click', function(){
    document.querySelectorAll('.kebab-menu.open').forEach(function(m){ m.classList.remove('open'); });
  });

  // ============ MODAL (Confirm) ============
  window.openModal = function(id){
    var m = document.getElementById(id);
    if(m) m.classList.add('open');
  };
  window.closeModal = function(id){
    var m = document.getElementById(id);
    if(m) m.classList.remove('open');
  };

  // ============ iOS PWA Detection ============
  window.isStandalonePWA = function(){
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
  };

  window.isIOS = function(){
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  };

  // ============ SMART PRINT (iOS-safe) ============
  window.smartPrint = function(opts){
    opts = opts || {};
    var title = opts.title || document.title;

    if(window.isStandalonePWA() && window.isIOS()){
      // iOS PWA: window.print() doesn't open dialog → use html2pdf fallback
      if(typeof html2pdf !== 'undefined' && opts.element){
        html2pdf().from(opts.element).set({
          margin: 12,
          filename: (opts.filename || title) + '.pdf',
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).save();
      } else {
        alert('โหมด PWA บน iOS — กรุณาเปิดในเบราว์เซอร์ Safari แล้วกดพิมพ์อีกครั้ง');
      }
    } else {
      window.print();
    }
  };

  // ============ AUTO-SAVE INDICATOR ============
  // Usage: autoSaveIndicator.update('saving' | 'saved' | 'error')
  window.autoSaveIndicator = {
    el: null,
    update: function(state, time){
      if(!this.el) this.el = document.querySelector('.save-indicator');
      if(!this.el) return;
      var t = time || new Date().toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'});
      if(state === 'saving') this.el.innerHTML = '⏳ กำลังบันทึก...';
      else if(state === 'saved') this.el.innerHTML = '✓ Auto-saved ' + t;
      else if(state === 'error') this.el.innerHTML = '<span style="color:#dc2626;">⚠ บันทึกล้มเหลว</span>';
    }
  };

  // ============ CHIP TOGGLE ============
  document.addEventListener('DOMContentLoaded', function(){
    document.querySelectorAll('[data-chip-radio]').forEach(function(group){
      group.querySelectorAll('.chip').forEach(function(c){
        c.addEventListener('click', function(){
          group.querySelectorAll('.chip').forEach(function(o){ o.classList.remove('selected'); });
          c.classList.add('selected');
          var input = group.querySelector('input[type=hidden]');
          if(input) input.value = c.dataset.value || c.textContent.trim();
        });
      });
    });
    document.querySelectorAll('[data-chip-multi] .chip').forEach(function(c){
      c.addEventListener('click', function(){ c.classList.toggle('selected'); });
    });
  });

  // ============ TIME UTIL ============
  window.fmtTime = function(d){
    d = d || new Date();
    if(typeof d === 'string') d = new Date(d);
    return d.toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'});
  };

  window.nowTime = function(){
    var d = new Date();
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  };

  window.fmtDuration = function(start, end){
    if(!start || !end) return '';
    var s = new Date(start).getTime();
    var e = new Date(end).getTime();
    var mins = Math.round((e - s) / 60000);
    if(mins < 60) return '+' + mins + 'm';
    return '+' + Math.floor(mins/60) + 'h ' + (mins%60) + 'm';
  };

  // ============ COMPANY LOGO (from settings.APP_LOGO_URL) ============
  // Replaces all "PT" placeholder logos with company logo if configured.
  // Targets: .splash-logo, .l-brand, .v2-rail .v2-logo, .v2-modrail .v2-logo
  window.loadCompanyLogo = async function(){
    if(typeof _supabase === 'undefined') return;
    try {
      var res = await _supabase.from('settings').select('value').eq('key', 'APP_LOGO_URL').maybeSingle();
      var url = res && res.data && res.data.value ? String(res.data.value).trim() : '';
      if(!url) return;
      // Apply as browser favicon
      if(window.setFaviconFromLogo) window.setFaviconFromLogo(url);
      var safe = url.replace(/"/g,'&quot;');
      var imgHtml = '<img src="' + safe + '" alt="logo" style="width:100%;height:100%;object-fit:contain;background:#fff;padding:3px;box-sizing:border-box;border-radius:inherit;">';
      var sels = ['.splash-logo', '.l-brand', '.v2-rail .v2-logo', '.v2-modrail .v2-logo'];
      sels.forEach(function(sel){
        document.querySelectorAll(sel).forEach(function(el){
          // Skip if already replaced (re-runs)
          if(el.querySelector('img')) return;
          el.innerHTML = imgHtml;
          el.style.overflow = 'hidden';
        });
      });
    } catch(e){ /* silent — keep PT default */ }
  };
  // Auto-run when supabase is ready
  document.addEventListener('DOMContentLoaded', function(){
    var tryLoad = function(retries){
      if(typeof _supabase !== 'undefined'){ window.loadCompanyLogo(); return; }
      if(retries > 0) setTimeout(function(){ tryLoad(retries - 1); }, 200);
    };
    tryLoad(20);  // wait up to 4 sec for supabase init
  });

  // ============ SERVICE WORKER REGISTRATION ============
  if('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('/pt-medical-system/v2/sw.js', {scope: '/pt-medical-system/v2/'})
        .catch(function(err){ console.warn('SW v2 registration failed:', err); });
    });
  }

})();

// ============================================================
// PCR PRINT BUILDER — window.buildPcrHtml(d)
// H Hybrid redesign: card-based 2-column layout, navy header,
// colour-accent section cards, 4/2-point timeline strip.
// Both transport/index.html and monitor/index.html call this.
//
// Canonical `d` object fields:
//   Meta / header
//     d.id            {string}  Case / doc number
//     d.date          {string}  Print timestamp (localised string)
//     d.logoSrc       {string}  Logo image src (base64 or URL, may be empty)
//     d.printHeader   {string}  Org name / print header from admin settings
//     d.nrStatus      {string}  NR status text
//     d.triageLevel   {string}  'Resuscitation'|'Emergency'|'Urgent'|'Non-Urgent'
//     d.consentSigned {boolean} Whether consent has been signed
//   Section 01 — Operation
//     d.transportType {string}  'EMS' or 'Refer'
//     d.opLevel       {string}  'BLS'|'ALS' etc.
//     d.opUnit        {string}  Unit / vehicle number text
//     d.sceneType     {string}  'Trauma'|'Non-Trauma' (EMS only)
//     d.sceneMoi      {string}  MOI / NOI text (EMS only)
//     d.staffList     {string}  Comma-joined staff names + roles
//   Timeline (EMS = 4-point, Refer = 2-point)
//     d.tlDispatch    {string}  HH:mm  (EMS)
//     d.tlArrScene    {string}  HH:mm  (EMS)
//     d.tlDeptScene   {string}  HH:mm  (EMS)
//     d.tlArrHosp     {string}  HH:mm  (EMS)
//     d.tlDeptOrigin  {string}  HH:mm  (Refer)
//     d.tlArrDest     {string}  HH:mm  (Refer)
//   Section 02 — Patient
//     d.ptName        {string}
//     d.ptAge         {string}
//     d.ptGender      {string}
//     d.idCard        {string}  Thai ID or passport number
//     d.idType        {string}  'ThaiID'|'Passport'
//     d.idDisplay     {string}  Pre-formatted "ID: ..." or "Passport: ..."
//     d.origin        {string}
//     d.dest          {string}
//     d.cc            {string}  Chief complaint
//     d.dx            {string}  Diagnosis
//     d.allergies     {string}
//     d.underlying    {string}  Comma-joined U/D list
//     d.meds          {string}
//   Section 03 — Initial Vitals
//     d.initTime      {string}  HH:mm of initial vitals
//     d.initBP        {string}
//     d.initPR        {string}
//     d.initRR        {string}
//     d.initTemp      {string}
//     d.initSpO2      {string}
//     d.initDTX       {string}
//     d.pain          {string}  Pain score (shared with PA section)
//   Section 04 — Physical Assessment
//     d.airway        {string}
//     d.breathing     {string}
//     d.circStatus    {string}
//     d.ekg           {string}
//     d.centralLine   {string}
//     d.gcs           {string}  Pre-formatted e.g. 'E4V5M6'
//     d.pupilSize     {string}
//     d.pupilReact    {string}
//     d.motorRA/LA/RL/LL {string}
//     d.expRA/LA/RL/LL   {string}
//     d.expOther      {string}
//     d.tubes         {string}  Comma-joined tube notes
//   Cardiac Arrest (conditional)
//     d.arrestPre     {object}  { active, time, cprTime, rhythm, outcome, roscTime, deadTime, note }
//   Section 05 — Fluids & Meds / Equipment
//     d.ivRowsHtml    {string}  Pre-built <tr>...</tr> rows for fluids table
//     d.equipment     {string}
//   Section 06 — Vitals Log
//     d.vitalsRowsHtml {string} Pre-built <tr>...</tr> rows for vitals log
//   Section 07 — Nurse Note
//     d.nurseNote     {string}
//   Signatures
//     d.sigRecorder   {string}  Recorder name (optional, shown above line)
//     d.loggedUser    {string}  For footer "Printed by"
// ============================================================
window.buildPcrHtml = function(d) {
  'use strict';

  // --- escape helper (standalone — shared.js has no escapeHtml) ---
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  // --- empty display helper ---
  function orDash(v) { return (v && String(v).trim()) ? v : '—'; }
  function vNum(v)   { return (v && String(v).trim()) ? v : '—'; }
  function isEmpty(v){ return !v || !String(v).trim() || v === '-'; }

  // --- triage map ---
  var triageMap = {
    'Resuscitation': { bg: '#c0392b', label: 'RED',    sub: 'Resuscitation' },
    'Emergency':     { bg: '#d63384', label: 'PINK',   sub: 'Emergency' },
    'Urgent':        { bg: '#e6a817', label: 'YELLOW', sub: 'Urgent' },
    'Non-Urgent':    { bg: '#198754', label: 'GREEN',  sub: 'Non-Urgent' }
  };
  var triage = triageMap[d.triageLevel] || triageMap['Non-Urgent'];

  var isEms = d.transportType === 'EMS';

  // =========================================================
  // CSS — copied from v2/preview/transport-pcr.html
  // Print-safe: no zoom, no overflow:hidden on html/body.
  // =========================================================
  var css = [
    "@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');",
    ":root {",
    "  --ink:#1a1d2b; --ink-soft:#5a6072; --ink-faint:#9099aa;",
    "  --line:#e2e5ec; --line-soft:#eef0f4;",
    "  --navy:#112a44; --alert:#c1281d; --alert-bg:#fdf1ef;",
    "  --tone-blue:#2654b8; --tone-violet:#6b3ec9; --tone-amber:#c47a08;",
    "  --tone-teal:#0a7a7a; --tone-rose:#c93770; --tone-slate:#475569;",
    "  color-scheme: light only;",
    "}",
    "* { box-sizing:border-box; margin:0; padding:0; }",
    "html, body { background:#fff; }",
    "body { font-family:'Sarabun',system-ui,sans-serif; font-size:10.5px; line-height:1.45; color:var(--ink); }",
    ".mono { font-family:'JetBrains Mono',ui-monospace,monospace; }",

    /* ctrl bar */
    ".ctrl-bar { background:#1a1d2b; padding:9px 14px; display:flex; gap:8px; align-items:center; position:sticky; top:0; z-index:9999; }",
    ".btn-p { background:#2654b8; color:#fff; border:none; padding:7px 18px; border-radius:6px; font-size:13px; cursor:pointer; font-family:inherit; font-weight:700; }",
    ".btn-c { background:#475569; color:#fff; border:none; padding:7px 18px; border-radius:6px; font-size:13px; cursor:pointer; font-family:inherit; }",
    ".btn-p:hover { background:#1e43a0; } .btn-c:hover { background:#334155; }",

    /* sheet */
    ".pcr-sheet { width:210mm; min-height:297mm; margin:12px auto; padding:11mm 12mm 10mm; background:#fff; }",

    /* header */
    ".pcr-head { display:flex; justify-content:space-between; align-items:center; background:var(--navy); color:#fff; border-radius:7px; padding:9px 14px; margin-bottom:9px; }",
    ".pcr-head-left { display:flex; align-items:center; gap:11px; }",
    ".pcr-logo { width:38px; height:38px; border-radius:50%; background:#fff; display:flex; align-items:center; justify-content:center; flex:0 0 auto; overflow:hidden; }",
    ".pcr-logo img { width:100%; height:100%; object-fit:contain; }",
    ".pcr-logo svg { display:block; }",
    ".pcr-org { font-size:15px; font-weight:700; letter-spacing:-0.01em; line-height:1.15; }",
    ".pcr-org-sub { font-size:8.5px; color:#aeb9c9; letter-spacing:0.03em; margin-top:1px; }",
    ".pcr-head-right { display:flex; align-items:stretch; gap:7px; }",
    ".pcr-meta { background:rgba(255,255,255,0.08); border-radius:5px; padding:4px 9px; display:flex; flex-direction:column; justify-content:center; min-width:64px; }",
    ".pcr-meta-lab { font-size:7.5px; letter-spacing:0.13em; color:#8b97a8; font-weight:600; }",
    ".pcr-meta-val { font-size:10.5px; font-weight:600; color:#fff; }",
    ".pcr-triage { border-radius:5px; padding:4px 11px; display:flex; flex-direction:column; justify-content:center; text-align:center; }",
    ".pcr-triage-lab { font-size:11px; font-weight:800; letter-spacing:0.05em; line-height:1.1; }",
    ".pcr-triage-sub { font-size:7.5px; font-weight:600; opacity:0.85; }",
    ".pcr-consent-yes { background:#1e7d44; color:#fff; border-radius:5px; padding:4px 11px; font-size:10px; font-weight:700; letter-spacing:0.04em; display:flex; align-items:center; }",
    ".pcr-consent-no  { background:#7a6000; color:#fff; border-radius:5px; padding:4px 11px; font-size:10px; font-weight:700; letter-spacing:0.04em; display:flex; align-items:center; }",

    /* grid */
    ".pcr-grid { display:grid; grid-template-columns:1fr 1fr; gap:7px; }",
    ".pcr-full { grid-column:1 / -1; }",

    /* section card */
    ".sec { background:#fff; border:1px solid var(--line); border-left:3px solid var(--tone,var(--tone-blue)); border-radius:0 5px 5px 0; padding:6px 11px 8px; break-inside:avoid; }",
    ".sec-blue   { --tone:var(--tone-blue); }",
    ".sec-violet { --tone:var(--tone-violet); }",
    ".sec-amber  { --tone:var(--tone-amber); }",
    ".sec-teal   { --tone:var(--tone-teal); }",
    ".sec-rose   { --tone:var(--tone-rose); }",
    ".sec-slate  { --tone:var(--tone-slate); }",
    ".sec-head { display:flex; align-items:center; gap:7px; padding-bottom:4px; margin-bottom:5px; border-bottom:1px solid var(--line-soft); }",
    ".sec-n { background:var(--navy); color:#fff; font-size:8.5px; font-weight:700; border-radius:3px; padding:1px 5px; letter-spacing:0.04em; }",
    ".sec-title { font-size:11.5px; font-weight:700; color:var(--ink); }",
    ".sec-meta { margin-left:auto; font-size:9px; color:var(--ink-faint); font-family:'JetBrains Mono',ui-monospace,monospace; }",

    /* op pills */
    ".op-pills { display:flex; gap:5px; margin-bottom:7px; flex-wrap:wrap; }",
    ".pill { font-size:10px; font-weight:600; border-radius:99px; padding:2px 11px; border:1px solid var(--line); }",
    ".pill-on { background:var(--navy); color:#fff; border-color:var(--navy); }",

    /* timeline */
    ".tl-strip { display:grid; gap:5px; margin-bottom:7px; }",
    ".tl-strip-4 { grid-template-columns:repeat(4,1fr); }",
    ".tl-strip-2 { grid-template-columns:repeat(2,1fr); }",
    ".tl-node { background:#f4f6fa; border:1px solid var(--line); border-radius:4px; padding:4px 7px; }",
    ".tl-lab-th { font-size:9px; font-weight:600; color:var(--ink-soft); }",
    ".tl-lab-en { font-size:6.5px; font-weight:700; letter-spacing:0.1em; color:var(--ink-faint); }",
    ".tl-time { font-size:14px; font-weight:700; color:var(--navy); margin-top:1px; font-family:'JetBrains Mono',ui-monospace,monospace; }",
    ".tl-time.empty { color:var(--ink-faint); font-weight:400; }",

    /* key-value */
    ".kv { display:grid; grid-template-columns:64px 1fr; gap:1px 9px; }",
    ".kv dt { font-size:8.5px; letter-spacing:0.07em; text-transform:uppercase; color:var(--ink-faint); font-weight:600; padding-top:2px; }",
    ".kv dd { font-size:10.5px; margin:0; padding:1px 0; }",

    /* patient hero */
    ".pt-hero { display:flex; align-items:center; gap:9px; flex-wrap:wrap; padding-bottom:4px; margin-bottom:4px; border-bottom:1px solid var(--line-soft); }",
    ".pt-name { font-size:14px; font-weight:700; }",
    ".pt-tag { font-size:9.5px; padding:1px 7px; background:#f3eefd; color:var(--tone-violet); border-radius:3px; font-weight:600; white-space:nowrap; }",

    /* chief complaint strip */
    ".cc-strip { background:#fff; border:1px solid var(--line); border-radius:5px; padding:5px 11px; break-inside:avoid; }",
    ".cc-lab { font-size:8.5px; letter-spacing:0.12em; text-transform:uppercase; color:var(--ink-faint); font-weight:700; margin-right:8px; }",
    ".cc-val { font-size:10.5px; line-height:1.5; }",

    /* clinical row */
    ".clin-row { display:grid; grid-template-columns:1.5fr 1fr 1fr 1.1fr; gap:7px; }",
    ".clin-cell { background:#fff; border:1px solid var(--line); border-radius:5px; padding:5px 10px; break-inside:avoid; }",
    ".clin-lab { font-size:8px; letter-spacing:0.12em; text-transform:uppercase; color:var(--ink-faint); font-weight:700; }",
    ".clin-val { font-size:10.5px; margin-top:1px; }",
    ".clin-cell.allergy { background:var(--alert-bg); border-color:#f0c9c4; }",
    ".clin-cell.allergy .clin-lab { color:var(--alert); }",
    ".clin-cell.allergy .clin-val { color:var(--alert); font-weight:700; }",

    /* initial vitals strip */
    ".vitals-strip { display:grid; grid-template-columns:repeat(7,1fr); }",
    ".vital-cell { text-align:center; padding:4px 5px; border-right:1px solid var(--line-soft); }",
    ".vital-cell:last-child { border-right:none; }",
    ".vital-lab { font-size:8.5px; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink-faint); font-weight:700; }",
    ".vital-num { font-size:17px; font-weight:700; letter-spacing:-0.02em; line-height:1.15; color:var(--navy); font-family:'JetBrains Mono',ui-monospace,monospace; }",
    ".vital-num.empty { color:var(--ink-faint); font-weight:400; }",
    ".vital-unit { font-size:8px; color:var(--ink-faint); }",

    /* physical assessment */
    ".pa-grid { display:grid; grid-template-columns:1fr 1fr; gap:3px 14px; }",
    ".pa-cell { border-bottom:1px dashed var(--line-soft); padding:2px 0; min-width:0; }",
    ".pa-full { grid-column:1 / -1; }",
    ".pa-lab { font-size:8px; letter-spacing:0.09em; text-transform:uppercase; color:var(--ink-faint); font-weight:700; }",
    ".pa-val { font-size:10.5px; }",
    ".pa-val.alert { color:var(--alert); font-weight:700; }",
    ".pa-val.empty { color:var(--ink-faint); }",
    ".chip { display:inline-block; vertical-align:baseline; font-size:7.5px; font-weight:700; letter-spacing:0.06em; border-radius:3px; padding:1px 5px; margin-left:5px; background:#eef3fd; color:var(--tone-blue); border:1px solid #d6e2f8; }",
    ".chip-alert { background:var(--alert-bg); color:var(--alert); border-color:#f0c9c4; }",

    /* arrest box */
    ".arrest-box { border:2px solid var(--alert); border-radius:5px; break-inside:avoid; margin-top:6px; overflow:hidden; }",
    ".arrest-bar { background:var(--alert); color:#fff; font-size:9px; font-weight:700; letter-spacing:0.1em; padding:3px 10px; }",
    ".arrest-body { display:grid; grid-template-columns:80px 1fr 80px 1fr 90px 1fr; gap:1px 8px; padding:5px 10px 6px; }",
    ".arrest-lab { font-size:8px; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink-faint); font-weight:700; padding-top:1px; }",
    ".arrest-val { font-size:10.5px; }",
    ".arrest-row { background:#fff0f0!important; }",
    ".arrest-row td { border-bottom:1.5px solid var(--alert)!important; }",

    /* tables */
    ".tbl { width:100%; border-collapse:collapse; font-size:9.5px; }",
    ".tbl thead { display:table-header-group; }",
    ".tbl thead th { background:#f4f6fa; color:var(--ink-soft); font-size:8px; letter-spacing:0.06em; text-transform:uppercase; font-weight:700; padding:3px 6px; text-align:left; border-bottom:1px solid var(--line); }",
    ".tbl tbody td { padding:3px 6px; border-bottom:1px solid var(--line-soft); }",
    ".tbl tbody tr { break-inside:avoid; }",
    ".tbl .num { text-align:right; font-family:'JetBrains Mono',ui-monospace,monospace; }",
    ".tbl .mono { font-family:'JetBrains Mono',ui-monospace,monospace; }",
    ".tbl .empty-cell { color:var(--ink-faint); }",
    ".empty-box { text-align:center; color:var(--ink-faint); font-style:italic; padding:8px; font-size:10px; }",
    ".equip-line { margin-top:5px; padding-top:4px; border-top:1px solid var(--line-soft); display:flex; gap:8px; }",
    ".equip-lab { font-size:8px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink-faint); font-weight:700; padding-top:1px; }",
    ".equip-val { font-size:10px; }",

    /* nurse note */
    ".note-box { font-size:10.5px; line-height:1.6; min-height:30px; padding:2px 0; white-space:pre-wrap; word-wrap:break-word; }",
    ".note-box.empty { color:var(--ink-faint); font-style:italic; }",

    /* signatures */
    ".sig-block { margin-top:9px; break-inside:avoid; }",
    ".sig-bar { background:var(--navy); color:#fff; font-size:9px; font-weight:700; letter-spacing:0.14em; padding:3px 11px; border-radius:4px 4px 0 0; }",
    ".sig-row { display:grid; grid-template-columns:repeat(3,1fr); gap:22px; border:1px solid var(--line); border-top:none; border-radius:0 0 4px 4px; padding:10px 14px 8px; }",
    ".sig-cell { display:flex; flex-direction:column; }",
    ".sig-name { font-size:10px; min-height:15px; }",
    ".sig-line { border-bottom:1px solid var(--ink); margin:1px 0 3px; }",
    ".sig-role { display:flex; justify-content:space-between; }",
    ".sig-k { font-size:8.5px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink-soft); font-weight:700; }",
    ".sig-dt { font-size:8px; color:var(--ink-faint); }",

    /* footer */
    ".pcr-foot { display:flex; justify-content:space-between; margin-top:8px; padding-top:5px; border-top:1px solid var(--line); font-size:8.5px; color:var(--ink-faint); }",

    /* stack gap */
    ".pcr-stack > * + * { margin-top:7px; }",

    /* print */
    "@media print {",
    "  @page { size:A4 portrait; margin:11mm 12mm; }",
    "  html, body { background:#fff; }",
    "  .ctrl-bar { display:none!important; }",
    "  .pcr-sheet { width:auto; min-height:0; margin:0; padding:0; }",
    "  .sec, .cc-strip, .clin-cell, .sig-block, .tbl tbody tr { break-inside:avoid; }",
    "  body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }",
    "}"
  ].join('\n');

  // =========================================================
  // Helpers
  // =========================================================
  function tlNode(labelTh, labelEn, time) {
    var cls = isEmpty(time) ? 'tl-time empty' : 'tl-time mono';
    return '<div class="tl-node">' +
      '<div class="tl-lab-th">' + esc(labelTh) + '</div>' +
      '<div class="tl-lab-en">' + esc(labelEn) + '</div>' +
      '<div class="' + cls + '">' + esc(isEmpty(time) ? '—' : time) + '</div>' +
      '</div>';
  }

  function vitalCell(lab, val, unit) {
    var cls = isEmpty(val) ? 'vital-num empty' : 'vital-num';
    return '<div class="vital-cell">' +
      '<div class="vital-lab">' + esc(lab) + '</div>' +
      '<div class="' + cls + '">' + esc(isEmpty(val) ? '—' : val) + '</div>' +
      '<div class="vital-unit">' + esc(unit) + '</div>' +
      '</div>';
  }

  function paRow(lab, val, full, alertVal) {
    var valCls = 'pa-val' + (alertVal ? ' alert' : '') + (isEmpty(val) ? ' empty' : '');
    return '<div class="pa-cell' + (full ? ' pa-full' : '') + '">' +
      '<div class="pa-lab">' + esc(lab) + '</div>' +
      '<div class="' + valCls + '">' + (isEmpty(val) ? '—' : esc(val)) + '</div>' +
      '</div>';
  }

  // =========================================================
  // LOGO
  // =========================================================
  var logoHtml = '';
  if (d.logoSrc) {
    logoHtml = '<div class="pcr-logo"><img src="' + esc(d.logoSrc) + '" alt="logo"></div>';
  } else {
    logoHtml = '<div class="pcr-logo">' +
      '<svg viewBox="0 0 30 30" width="26" height="26">' +
      '<circle cx="15" cy="15" r="13" fill="#fff" stroke="#112a44" stroke-width="1.4"/>' +
      '<path d="M15 8v14M8 15h14" stroke="#c0392b" stroke-width="3.4" stroke-linecap="round"/>' +
      '</svg></div>';
  }

  // =========================================================
  // TRIAGE
  // =========================================================
  var triageHtml = '<div class="pcr-triage" style="background:' + esc(triage.bg) + ';color:#fff;">' +
    '<span class="pcr-triage-lab">' + esc(triage.label) + '</span>' +
    '<span class="pcr-triage-sub">' + esc(triage.sub) + '</span>' +
    '</div>';

  // =========================================================
  // CONSENT BADGE
  // =========================================================
  var consentHtml = d.consentSigned
    ? '<div class="pcr-consent-yes">✓ CONSENT</div>'
    : '<div class="pcr-consent-no">✗ NO CONSENT</div>';

  // =========================================================
  // TIMELINE
  // =========================================================
  var tlHtml = '';
  if (isEms) {
    // Labels MUST match the underlying data fields exactly (medical/legal doc):
    //   tlDispatch  = tl_dispatch_dt        → รับแจ้ง (received)
    //   tlArrScene  = tl_arrive_scene_dt    → ถึงจุดรับ (on scene)
    //   tlDeptScene = tl_depart_scene_dt    → ออกจากจุดรับ (depart scene)
    //   tlArrHosp   = tl_arrive_hospital_dt → ถึง รพ. (arrive hospital)
    // (The design mockup showed a "depart base" node — that field does NOT
    //  exist in the data model, so it is not used.)
    tlHtml = '<div class="tl-strip tl-strip-4">' +
      tlNode('รับแจ้ง', 'RECEIVED', d.tlDispatch) +
      tlNode('ถึงจุดรับ', 'ON SCENE', d.tlArrScene) +
      tlNode('ออกจากจุดรับ', 'DEPART SCENE', d.tlDeptScene) +
      tlNode('ถึง รพ.', 'ARRIVE HOSP.', d.tlArrHosp) +
      '</div>';
  } else {
    tlHtml = '<div class="tl-strip tl-strip-2">' +
      tlNode('ออกต้นทาง', 'DEPART ORIGIN', d.tlDeptOrigin) +
      tlNode('ถึงปลายทาง', 'ARRIVE DEST.', d.tlArrDest) +
      '</div>';
  }

  // =========================================================
  // SCENE row (EMS only, optional)
  // =========================================================
  var sceneKv = '';
  if (isEms && d.sceneType) {
    sceneKv = '<dt>Scene</dt><dd>' + esc(d.sceneType) +
      (d.sceneMoi ? ' — ' + esc(d.sceneMoi) : '') + '</dd>';
  }

  // =========================================================
  // AIRWAY / BREATHING chips
  // =========================================================
  function airwayDisplay(v) {
    v = v || '';
    var chips = '';
    if (/ET\s*Tube|ETT/i.test(v)) chips += '<span class="chip">ETT</span>';
    if (/LMA/i.test(v))           chips += '<span class="chip">LMA</span>';
    if (/King/i.test(v))          chips += '<span class="chip">King</span>';
    return esc(v) + chips;
  }
  function breathingDisplay(v) {
    v = v || '';
    var chips = '';
    if (/Ventilator/i.test(v)) {
      var modeMatch = v.match(/\(([^)]+)\)/);
      chips += '<span class="chip">VENT' + (modeMatch ? ' · ' + modeMatch[1] : '') + '</span>';
    }
    return esc(v) + chips;
  }

  // =========================================================
  // ARREST SECTION (rendered as card, placed after PA)
  // =========================================================
  var arrestHtml = '';
  if (d.arrestPre && d.arrestPre.active) {
    var a = d.arrestPre;
    var outcomeDetail = '';
    if (a.outcome === 'ROSC') outcomeDetail = ' — ROSC @ ' + (a.roscTime || '-');
    else if (a.outcome === 'Dead' || a.outcome === 'Terminate CPR')
      outcomeDetail = ' — @ ' + (a.deadTime || '-');

    arrestHtml =
      '<section class="sec sec-blue pcr-full" style="border-left-color:var(--alert);">' +
      '<div class="sec-head"><span class="sec-n" style="background:var(--alert);">⚠</span>' +
      '<span class="sec-title" style="color:var(--alert);">Cardiac Arrest — ก่อน/ระหว่างรับผู้ป่วย</span></div>' +
      '<div class="arrest-body">' +
      '<div class="arrest-lab">Arrest Time</div><div class="arrest-val mono">' + esc(a.time || '—') + '</div>' +
      '<div class="arrest-lab">CPR Start</div><div class="arrest-val mono">' + esc(a.cprTime || '—') + '</div>' +
      '<div class="arrest-lab">Init Rhythm</div><div class="arrest-val">' + esc(a.rhythm || '—') + '</div>' +
      '<div class="arrest-lab">Outcome</div><div class="arrest-val" style="font-weight:700;">' + esc((a.outcome || '—') + outcomeDetail) + '</div>' +
      '<div class="arrest-lab">Note</div><div class="arrest-val" style="grid-column:span 3;">' + esc(a.note || '—') + '</div>' +
      '</div>' +
      '</section>';
  }

  // =========================================================
  // VITALS LOG rows (already pre-built HTML from caller,
  //   but apply new table classes)
  // =========================================================
  var vitalsRows = d.vitalsRowsHtml || '';
  var ivRows     = d.ivRowsHtml     || '';

  // =========================================================
  // BUILD DOCUMENT
  // =========================================================
  var h = '<!DOCTYPE html><html lang="th"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>PCR — ' + esc(d.id || 'NEW') + '</title>' +
    '<style>' + css + '</style>' +
    '</head><body>';

  // --- CTRL BAR (screen only, hidden in print via CSS) ---
  h += '<div class="ctrl-bar no-print">' +
    '<button class="btn-p" onclick="window.print()">\u{1F5A8} สั่งพิมพ์ / Save PDF</button>';
  if (!d.publicShare) {
    h += '<button class="btn-c" onclick="if(typeof transport_closePrintView===\'function\')transport_closePrintView();">✕ กลับ</button>';
  }
  h += '</div>';

  // --- PCR SHEET ---
  h += '<div class="pcr-sheet pcr-stack">';

  // ===== HEADER =====
  h += '<header class="pcr-head">' +
    '<div class="pcr-head-left">' +
    logoHtml +
    '<div>' +
    '<div class="pcr-org">' + esc(d.printHeader || 'Patient Transport') + '</div>' +
    '<div class="pcr-org-sub">PATIENT TRANSPORT RECORD · แบบบันทึกการนำส่งผู้ป่วย</div>' +
    '</div>' +
    '</div>' +
    '<div class="pcr-head-right">' +
    '<div class="pcr-meta"><span class="pcr-meta-lab">DOC</span><span class="pcr-meta-val mono">' + esc(d.id || 'NEW') + '</span></div>' +
    '<div class="pcr-meta"><span class="pcr-meta-lab">NR</span><span class="pcr-meta-val">' + esc(orDash(d.nrStatus)) + '</span></div>' +
    triageHtml +
    consentHtml +
    '</div>' +
    '</header>';

  // ===== 01 OPERATION + 02 PATIENT (2-column grid) =====
  h += '<div class="pcr-grid">';

  // --- 01 OPERATION ---
  h += '<section class="sec sec-blue">' +
    '<div class="sec-head"><span class="sec-n">01</span><span class="sec-title">Operation</span></div>' +
    '<div class="op-pills">' +
    '<span class="pill ' + (d.transportType === 'EMS' ? 'pill-on' : '') + '">' + esc(d.transportType || 'EMS') + '</span>' +
    '<span class="pill">' + esc(orDash(d.opLevel)) + '</span>' +
    (d.opUnit ? '<span class="pill">' + esc(d.opUnit) + '</span>' : '') +
    '</div>' +
    tlHtml +
    '<dl class="kv">' +
    (sceneKv) +
    '<dt>Staff</dt><dd>' + esc(orDash(d.staffList)) + '</dd>' +
    '</dl>' +
    '</section>';

  // --- 02 PATIENT ---
  var ptTag = [d.ptGender, d.ptAge ? d.ptAge + 'y' : ''].filter(Boolean).join(' · ');
  h += '<section class="sec sec-violet">' +
    '<div class="sec-head"><span class="sec-n">02</span><span class="sec-title">Patient</span></div>' +
    '<div class="pt-hero">' +
    '<span class="pt-name">' + esc(orDash(d.ptName)) + '</span>' +
    (ptTag ? '<span class="pt-tag">' + esc(ptTag) + '</span>' : '') +
    '</div>' +
    '<dl class="kv">' +
    '<dt>' + esc(d.idType === 'Passport' ? 'Passport' : 'ID') + '</dt><dd>' + esc(orDash(d.idDisplay)) + '</dd>' +
    '<dt>Origin</dt><dd>' + esc(orDash(d.origin)) + '</dd>' +
    '<dt>Destination</dt><dd>' + esc(orDash(d.dest)) + '</dd>' +
    '</dl>' +
    '</section>';

  h += '</div>'; // end pcr-grid

  // ===== CHIEF COMPLAINT =====
  h += '<div class="cc-strip">' +
    '<span class="cc-lab">Chief Complaint</span>' +
    '<span class="cc-val">' + esc(orDash(d.cc)) + '</span>' +
    '</div>';

  // ===== CLINICAL ROW (Dx / U/D / Meds / Allergy) =====
  h += '<div class="clin-row">' +
    '<div class="clin-cell"><div class="clin-lab">Dx</div><div class="clin-val">' + esc(orDash(d.dx)) + '</div></div>' +
    '<div class="clin-cell"><div class="clin-lab">U/D</div><div class="clin-val">' + esc(orDash(d.underlying)) + '</div></div>' +
    '<div class="clin-cell"><div class="clin-lab">Meds</div><div class="clin-val">' + esc(orDash(d.meds)) + '</div></div>' +
    '<div class="clin-cell allergy"><div class="clin-lab">⚠ Allergy</div><div class="clin-val">' + esc(orDash(d.allergies)) + '</div></div>' +
    '</div>';

  // ===== 03 INITIAL VITALS =====
  var initTimeMeta = d.initTime ? '<span class="sec-meta">@ ' + esc(d.initTime) + '</span>' : '';
  h += '<section class="sec sec-amber pcr-full">' +
    '<div class="sec-head"><span class="sec-n">03</span><span class="sec-title">Initial Vitals</span>' + initTimeMeta + '</div>' +
    '<div class="vitals-strip">' +
    vitalCell('BP',   d.initBP,   'mmHg') +
    vitalCell('PR',   d.initPR,   'bpm')  +
    vitalCell('RR',   d.initRR,   '/min') +
    vitalCell('T°', d.initTemp, '°C') +
    vitalCell('SpO₂', d.initSpO2, '%') +
    vitalCell('DTX',  d.initDTX,  'mg/dL') +
    vitalCell('Pain', d.pain,     '/10')  +
    '</div>' +
    '</section>';

  // ===== 04 PHYSICAL ASSESSMENT + 05 FLUIDS (2-column grid) =====
  h += '<div class="pcr-grid">';

  // --- 04 PHYSICAL ASSESSMENT ---
  var circVal = d.circStatus + (d.ekg ? ' · EKG: ' + d.ekg : '');
  var motorVal = 'RA:' + (d.motorRA||'—') + '  LA:' + (d.motorLA||'—') + '  RL:' + (d.motorRL||'—') + '  LL:' + (d.motorLL||'—');
  var expVal   = 'RA:' + (d.expRA||'—')   + '  LA:' + (d.expLA||'—')   + '  RL:' + (d.expRL||'—')   + '  LL:' + (d.expLL||'—') + (d.expOther ? '  ' + d.expOther : '');
  var pupilVal = (d.pupilSize || '—') + ' / ' + (d.pupilReact || '—');

  h += '<section class="sec sec-teal">' +
    '<div class="sec-head"><span class="sec-n">04</span><span class="sec-title">Physical Assessment</span></div>' +
    '<div class="pa-grid">' +
    '<div class="pa-cell"><div class="pa-lab">Airway</div><div class="pa-val">' + airwayDisplay(d.airway) + '</div></div>' +
    '<div class="pa-cell"><div class="pa-lab">Breathing</div><div class="pa-val">' + breathingDisplay(d.breathing) + '</div></div>' +
    '<div class="pa-cell"><div class="pa-lab">Circulation</div><div class="pa-val">' + esc(orDash(circVal)) + '</div></div>' +
    '<div class="pa-cell"><div class="pa-lab">C-Line</div><div class="pa-val">' + esc(orDash(d.centralLine)) + '</div></div>' +
    '<div class="pa-cell"><div class="pa-lab">GCS</div><div class="pa-val mono">' + esc(orDash(d.gcs)) + '</div></div>' +
    '<div class="pa-cell"><div class="pa-lab">Pupils</div><div class="pa-val">' + esc(pupilVal) + '</div></div>' +
    '<div class="pa-cell"><div class="pa-lab">Pain</div><div class="pa-val' + (isEmpty(d.pain) ? ' empty' : '') + '">' + esc(isEmpty(d.pain) ? '—' : d.pain + ' / 10') + '</div></div>' +
    '<div class="pa-cell"><div class="pa-lab">Tubes</div><div class="pa-val">' + esc(orDash(d.tubes)) + '</div></div>' +
    '<div class="pa-cell pa-full"><div class="pa-lab">Motor</div><div class="pa-val mono">' + esc(motorVal) + '</div></div>' +
    '<div class="pa-cell pa-full"><div class="pa-lab">Exposure</div><div class="pa-val mono">' + esc(expVal) + '</div></div>' +
    '</div>' +
    '</section>';

  // --- 05 FLUIDS & MEDS ---
  h += '<section class="sec sec-rose">' +
    '<div class="sec-head"><span class="sec-n">05</span><span class="sec-title">Fluids &amp; Meds</span></div>' +
    '<table class="tbl">' +
    '<thead><tr><th>Time</th><th>Item</th><th>Context</th><th>Route</th><th>Rate</th><th>Sedate</th></tr></thead>' +
    '<tbody>' + (ivRows || '<tr><td colspan="6" class="empty-box">— No IV/Meds —</td></tr>') + '</tbody>' +
    '</table>' +
    '<div class="equip-line"><span class="equip-lab">Equipment</span><span class="equip-val">' + esc(orDash(d.equipment)) + '</span></div>' +
    '</section>';

  h += '</div>'; // end pcr-grid

  // ===== ARREST SECTION (conditional, full-width) =====
  h += arrestHtml;

  // ===== 06 VITALS LOG =====
  h += '<section class="sec sec-blue pcr-full">' +
    '<div class="sec-head"><span class="sec-n">06</span><span class="sec-title">Vitals Log</span></div>' +
    '<table class="tbl">' +
    '<thead><tr><th>Time</th><th>BP</th><th>PR</th><th>RR</th><th>T°</th><th>SpO₂</th><th>GCS</th><th>Pain</th><th style="width:28%;">Note</th></tr></thead>' +
    '<tbody>' + (vitalsRows || '<tr><td colspan="9" class="empty-box">— No vitals recorded —</td></tr>') + '</tbody>' +
    '</table>' +
    '</section>';

  // ===== 07 NURSE NOTE =====
  var noteEmpty = isEmpty(d.nurseNote);
  h += '<section class="sec sec-slate pcr-full">' +
    '<div class="sec-head"><span class="sec-n">07</span><span class="sec-title">Nurse Note</span>' +
    '<span class="sec-meta">บันทึกเพิ่มเติม</span></div>' +
    '<div class="note-box' + (noteEmpty ? ' empty' : '') + '">' +
    (noteEmpty ? '—' : esc(d.nurseNote)) +
    '</div>' +
    '</section>';

  // ===== SIGNATURES =====
  h += '<div class="sig-block">' +
    '<div class="sig-bar">SIGNATURES</div>' +
    '<div class="sig-row">' +
    '<div class="sig-cell">' +
    '<div class="sig-name">' + esc(d.sigRecorder || ' ') + '</div>' +
    '<div class="sig-line"></div>' +
    '<div class="sig-role"><span class="sig-k">Recorder</span><span class="sig-dt">date · time</span></div>' +
    '</div>' +
    '<div class="sig-cell">' +
    '<div class="sig-name">&nbsp;</div>' +
    '<div class="sig-line"></div>' +
    '<div class="sig-role"><span class="sig-k">Sender</span><span class="sig-dt">date · time</span></div>' +
    '</div>' +
    '<div class="sig-cell">' +
    '<div class="sig-name">&nbsp;</div>' +
    '<div class="sig-line"></div>' +
    '<div class="sig-role"><span class="sig-k">Receiver</span><span class="sig-dt">date · time</span></div>' +
    '</div>' +
    '</div>' +
    '</div>';

  // ===== FOOTER =====
  h += '<div class="pcr-foot">' +
    '<span>' + esc(d.printHeader || 'Patient Transport Record') + '</span>' +
    '<span class="mono">' + esc(d.id || '') + '</span>' +
    '<span>พิมพ์โดย: ' + esc(d.loggedUser || '-') + ' · ' + esc(d.date || '') + '</span>' +
    '</div>';

  h += '</div>'; // end pcr-sheet
  h += '</body></html>';

  return h;
};
