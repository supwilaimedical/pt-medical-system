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

  // ============ SERVICE WORKER REGISTRATION ============
  if('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('/pt-medical-system/v2/sw.js', {scope: '/pt-medical-system/v2/'})
        .catch(function(err){ console.warn('SW v2 registration failed:', err); });
    });
  }

})();
