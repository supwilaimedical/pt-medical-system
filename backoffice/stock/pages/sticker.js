/* Stock - Sticker (B1 single PNG + A4 sheet)
 * Templates and logic preserved from existing system. */
(function(){
  let mode = 'a4';
  let skuData = null;
  let dataArr = [];
  let lots = [];
  let logo = '';

  const SVG_TPL_50x30 = '<svg xmlns="http://www.w3.org/2000/svg" width="591" height="354" viewBox="0 0 591 354" font-family="Sarabun, sans-serif">'
    + '<rect x="0" y="0" width="591" height="354" fill="#FFFFFF"/>'
    + '<rect x="18" y="37" width="280" height="280" fill="#FFFFFF"/>'
    + '<image x="18" y="37" width="280" height="280" href="{QR_HREF}" image-rendering="pixelated"/>'
    + '<text x="320" y="60" font-family="JetBrains Mono, monospace" font-size="44" font-weight="700" fill="#111">{SKU_CODE}</text>'
    + '<line x1="320" y1="80" x2="573" y2="80" stroke="#111" stroke-width="1.5"/>'
    + '<text x="320" y="120" font-family="Sarabun, sans-serif" font-size="26" font-weight="700" fill="#111">{NAME}</text>'
    + '<text x="320" y="154" font-family="Sarabun, sans-serif" font-size="17" font-weight="400" fill="#6b6b66">({UNIT})</text>'
    + '<text x="320" y="222" font-family="JetBrains Mono, monospace" font-size="12" font-weight="500" fill="#8a8a82">LOT</text>'
    + '<text x="352" y="222" font-family="JetBrains Mono, monospace" font-size="18" font-weight="700" fill="#111">{LOT}</text>'
    + '<text x="320" y="246" font-family="JetBrains Mono, monospace" font-size="12" font-weight="500" fill="#8a8a82">EXP</text>'
    + '<text x="352" y="246" font-family="JetBrains Mono, monospace" font-size="18" font-weight="700" fill="#111">{EXPIRY}</text>'
    + '<g>'
    +   '<text x="320" y="328" font-family="JetBrains Mono, monospace" font-size="13" font-weight="500" fill="#8a8a82">TYPE</text>'
    +   '<rect x="376" y="308" width="197" height="28" rx="4" fill="{TYPE_COLOR}"/>'
    +   '<text x="390" y="326.6666" font-family="JetBrains Mono, monospace" font-size="14" font-weight="700" fill="#FFFFFF">{TYPE}</text>'
    +   '<text x="422" y="325.6666" font-family="JetBrains Mono, monospace" font-size="11" font-weight="500" fill="#FFFFFF" fill-opacity="0.86">{TYPE_LABEL}</text>'
    + '</g></svg>';

  const SVG_TPL_40x30 = '<svg xmlns="http://www.w3.org/2000/svg" width="472" height="354" viewBox="0 0 472 354" font-family="Sarabun, sans-serif">'
    + '<rect x="0" y="0" width="472" height="354" fill="#FFFFFF"/>'
    + '<rect x="14" y="51" width="252" height="252" fill="#FFFFFF"/>'
    + '<image x="14" y="51" width="252" height="252" href="{QR_HREF}" image-rendering="pixelated"/>'
    + '<text x="284" y="50" font-family="JetBrains Mono, monospace" font-size="32" font-weight="700" fill="#111">{SKU_CODE}</text>'
    + '<line x1="284" y1="64" x2="458" y2="64" stroke="#111" stroke-width="1.5"/>'
    + '<text x="284" y="96" font-family="Sarabun, sans-serif" font-size="21" font-weight="700" fill="#111">{NAME}</text>'
    + '<text x="284" y="124" font-family="Sarabun, sans-serif" font-size="14" font-weight="400" fill="#6b6b66">({UNIT})</text>'
    + '<text x="284" y="190" font-family="JetBrains Mono, monospace" font-size="10" font-weight="500" fill="#8a8a82">LOT</text>'
    + '<text x="310" y="190" font-family="JetBrains Mono, monospace" font-size="15" font-weight="700" fill="#111">{LOT}</text>'
    + '<text x="284" y="210" font-family="JetBrains Mono, monospace" font-size="10" font-weight="500" fill="#8a8a82">EXP</text>'
    + '<text x="310" y="210" font-family="JetBrains Mono, monospace" font-size="15" font-weight="700" fill="#111">{EXPIRY}</text>'
    + '<g>'
    +   '<text x="284" y="333" font-family="JetBrains Mono, monospace" font-size="11" font-weight="500" fill="#8a8a82">TYPE</text>'
    +   '<rect x="332" y="316" width="126" height="24" rx="4" fill="{TYPE_COLOR}"/>'
    +   '<text x="343" y="332" font-family="JetBrains Mono, monospace" font-size="12" font-weight="700" fill="#FFFFFF">{TYPE}</text>'
    +   '<text x="375" y="331" font-family="JetBrains Mono, monospace" font-size="9" font-weight="500" fill="#FFFFFF" fill-opacity="0.86">{TYPE_LABEL}</text>'
    + '</g></svg>';

  const TPL_CFG = {
    '50x30': { canvasW:591, canvasH:354, qrSize:280, prevW:'150mm', nameMax:22, lotMax:14 },
    '40x30': { canvasW:472, canvasH:354, qrSize:252, prevW:'120mm', nameMax:18, lotMax:12 }
  };

  function typeColor(t){
    return {PH:'#C41E3A',MD:'#7C2D12',EQ:'#1A237E',CN:'#52525B',DC:'#92400E',TL:'#B45309',OX:'#0EA5E9'}[t] || '#6B7280';
  }
  function typeLabel(t){
    return {PH:'PHARMA',MD:'MEDICAL',EQ:'EQUIPMENT',CN:'CONSUMABLE',DC:'DOCUMENT',TL:'TOOLS',OX:'OXYGEN'}[t] || (t||'').toUpperCase();
  }
  function xmlEsc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
  function clip(s,n){ s=String(s||''); return s.length<=n ? s : s.slice(0,n-1)+'…'; }

  function makeQrDataUrl(text, size){
    return new Promise(res => {
      const div = document.createElement('div');
      div.style.cssText='position:absolute;left:-9999px;top:-9999px;';
      document.body.appendChild(div);
      new QRCode(div, { text, width:size, height:size, correctLevel:QRCode.CorrectLevel.M });
      setTimeout(() => {
        const c = div.querySelector('canvas');
        const i = div.querySelector('img');
        const url = c ? c.toDataURL('image/png') : (i ? i.src : '');
        document.body.removeChild(div);
        res(url);
      }, 60);
    });
  }

  async function renderB1(root){
    if (!skuData) return;
    const sizeKey = root.querySelector('#stkSize').value;
    const cfg = TPL_CFG[sizeKey] || TPL_CFG['50x30'];
    const tplSrc = (sizeKey==='40x30') ? SVG_TPL_40x30 : SVG_TPL_50x30;

    const canvas = root.querySelector('#stkB1Canvas');
    canvas.width = cfg.canvasW; canvas.height = cfg.canvasH;
    canvas.style.width = cfg.prevW; canvas.style.height = 'auto'; canvas.style.maxWidth = '100%';

    const lotSel = root.querySelector('#stkLotSel');
    const lotId = lotSel ? lotSel.value : '';
    const lot = (skuData.has_expiry && lotId) ? lots.find(L => L.id === lotId) : null;

    const qrText = skuData.qr_payload || skuData.sku_code;
    const qrDataUrl = await makeQrDataUrl(qrText, cfg.qrSize);

    const typeId = skuData.type_id || '';
    const svg = tplSrc
      .replace('{SKU_CODE}',   xmlEsc(clip(skuData.sku_code||'', 10)))
      .replace('{NAME}',       xmlEsc(clip(skuData.name||'', cfg.nameMax)))
      .replace('{UNIT}',       xmlEsc(clip(skuData.unit||'-', 10)))
      .replace('{TYPE}',       xmlEsc(typeId))
      .replace('{TYPE_LABEL}', xmlEsc(typeLabel(typeId)))
      .replace('{TYPE_COLOR}', typeColor(typeId))
      .replace('{LOT}',        xmlEsc(clip(lot ? (lot.lot_number||'-') : '-', cfg.lotMax)))
      .replace('{EXPIRY}',     xmlEsc(lot && lot.expiry_date ? lot.expiry_date : '-'))
      .replace('{QR_HREF}',    qrDataUrl);

    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch(_){}

    const blob = new Blob([svg], { type:'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('SVG render fail'));
      img.src = url;
    });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,cfg.canvasW,cfg.canvasH);
    ctx.drawImage(img, 0, 0, cfg.canvasW, cfg.canvasH);
    URL.revokeObjectURL(url);
  }

  function renderA4(root){
    const copies = Math.max(1, Math.min(100, parseInt(root.querySelector('#stkCopies').value,10)||1));
    const sheet = root.querySelector('#stkSheet');
    if (!dataArr.length){ sheet.innerHTML=''; return; }
    const tiles = [];
    dataArr.forEach(s => { for (let i=0;i<copies;i++) tiles.push(s); });
    sheet.innerHTML = tiles.map((s, idx) =>
      '<div class="sticker">'
      + '<div class="qr-img" id="qr-'+idx+'"></div>'
      + '<div class="info">'
      +   '<div class="stk-code">'+boEscape(s.sku_code)+'</div>'
      +   '<div class="stk-name">'+boEscape(s.name||'')+'</div>'
      +   (s.unit ? '<div class="stk-meta">หน่วย: '+boEscape(s.unit)+'</div>' : '')
      + '</div>'
      + (logo ? '<div class="stk-logo"><img src="'+logo+'" alt=""></div>' : '')
      + '</div>'
    ).join('');
    const qrSize = 83;
    tiles.forEach((s, idx) => {
      new QRCode(root.querySelector('#qr-'+idx), {
        text: s.qr_payload || s.sku_code,
        width:qrSize, height:qrSize, correctLevel:QRCode.CorrectLevel.M
      });
    });
  }

  function doRender(root){
    if (mode === 'b1') renderB1(root); else renderA4(root);
  }

  function downloadPng(root){
    if (!skuData){ boToast('ไม่มีข้อมูล SKU','err'); return; }
    const canvas = root.querySelector('#stkB1Canvas');
    setTimeout(() => {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      const lot = lots.find(L => L.id === (root.querySelector('#stkLotSel')||{}).value);
      const lotPart = lot ? '_'+lot.lot_number : '';
      a.href = url;
      a.download = skuData.sku_code+lotPart+'_'+root.querySelector('#stkSize').value+'.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }, 100);
  }

  function printA4(){
    if (!dataArr.length){ boToast('ไม่มี sticker','err'); return; }
    document.body.classList.add('printing-stickers');
    setTimeout(() => {
      window.print();
      setTimeout(() => document.body.classList.remove('printing-stickers'), 500);
    }, 50);
  }

  async function loadB1(root, payload){
    const code = payload.sku_code;
    if (!code){
      root.querySelector('#stkB1Preview').innerHTML = '<div style="padding:40px;color:var(--ink-3);">เลือก SKU จากหน้ารายการสินค้าก่อน</div>';
      return;
    }
    try {
      const [skuR, lotsR] = await Promise.all([
        boApi('stock_getSku', { sku_code: code }),
        boApi('stock_listLots', { filter: { limit: 5000 } }).catch(()=>({lots:[]}))
      ]);
      skuData = skuR.sku;
      if (!skuData) throw new Error('SKU not found');
      root.querySelector('#stkCount').textContent = code + ' · ' + (skuData.name||'');

      if (skuData.has_expiry){
        const entR = await boApi('stock_listEntries', { filter: { sku_code: code, limit: 100 } });
        const entIds = (entR.entries||[]).map(e => e.id);
        lots = (lotsR.lots||[]).filter(L => entIds.includes(L.entry_id));
        lots.sort((a,b) => (b.expiry_date||'').localeCompare(a.expiry_date||''));
        const sel = root.querySelector('#stkLotSel');
        sel.innerHTML = '<option value="">— ไม่มี lot —</option>' +
          lots.map(L => {
            const exp = L.expiry_date ? L.expiry_date.slice(0,7) : '?';
            return '<option value="'+L.id+'">'+boEscape(L.lot_number||'-')+' · exp '+exp+' · qty '+L.qty+'</option>';
          }).join('');
        if (payload.lot_id) sel.value = payload.lot_id;
        else if (lots.length) sel.value = lots[0].id;
      } else {
        root.querySelector('#stkLotPickerBox').style.display = 'none';
      }
      if (payload.size === '40x30') root.querySelector('#stkSize').value = '40x30';
      doRender(root);
    } catch(e){
      root.querySelector('#stkB1Preview').innerHTML = '<div style="padding:40px;color:var(--danger);">โหลดผิดพลาด: '+boEscape(e.message)+'</div>';
    }
  }

  async function loadA4(root, payload){
    const codes = payload.codes || [];
    if (!codes.length){
      root.querySelector('#stkSheet').innerHTML = '<div style="padding:40px;text-align:center;color:var(--ink-3);">เลือก SKU จากหน้ารายการสินค้าก่อน</div>';
      return;
    }
    root.querySelector('#stkCount').textContent = codes.length + ' รายการ';
    dataArr = [];
    for (const code of codes){
      try {
        const r = await boApi('stock_getSku', { sku_code: code });
        if (r.status === 'success') dataArr.push(r.sku);
      } catch(e){}
    }
    doRender(root);
  }

  async function load(root){
    try {
      const cached = sessionStorage.getItem('stkLogo');
      if (cached) logo = cached;
      else {
        const s = await boApi('getSettings');
        logo = (s.company && s.company.logoDataUrl) || '';
        sessionStorage.setItem('stkLogo', logo);
      }
    } catch(e){ logo = ''; }

    let payload = {};
    try { payload = JSON.parse(sessionStorage.getItem('stkPayload') || '{}'); } catch(e){}
    if (!payload.mode){
      const raw = sessionStorage.getItem('stockStickerCodes');
      if (raw){ try { payload = { mode:'a4', codes:JSON.parse(raw) }; } catch(e){} }
    }
    mode = payload.mode || 'a4';

    if (mode === 'b1'){
      root.querySelector('#stkModeBadge').textContent = 'B1 (single sticker)';
      root.querySelector('#stkModeBadge').style.background = '#FEF3C7';
      root.querySelector('#stkModeBadge').style.color = '#92400E';
      root.querySelector('#stkLotPickerBox').style.display = 'flex';
      root.querySelector('#stkCopiesBox').style.display = 'none';
      root.querySelector('#stkBtnDownload').style.display = '';
      root.querySelector('#stkBtnPrint').style.display = 'none';
      root.querySelector('#stkB1Preview').style.display = '';
      root.querySelector('#stkSheet').style.display = 'none';
      root.querySelector('#stkHint').textContent = '💡 Download PNG → import เข้า NIIMBOT app เพื่อพิมพ์';
      await loadB1(root, payload);
    } else {
      root.querySelector('#stkModeBadge').textContent = 'A4 (bulk shelf labels)';
      root.querySelector('#stkLotPickerBox').style.display = 'none';
      root.querySelector('#stkCopiesBox').style.display = 'flex';
      root.querySelector('#stkBtnDownload').style.display = 'none';
      root.querySelector('#stkBtnPrint').style.display = '';
      root.querySelector('#stkB1Preview').style.display = 'none';
      root.querySelector('#stkSheet').style.display = '';
      root.querySelector('#stkHint').textContent = '💡 A4 grid 50×30mm — เปิด print → "Save as PDF"';
      root.querySelector('#stkSize').value = '50x30';
      root.querySelector('#stkSize').disabled = true;
      await loadA4(root, payload);
    }
  }

  window.PAGES = window.PAGES || {};
  window.PAGES['sticker'] = function(root){
    root.innerHTML = ''
      + '<div class="pt-content__topbar">'
      +   '<h1 class="pt-content__title"><i class="bi bi-tag"></i> สติ๊กเกอร์ <span id="stkModeBadge" style="font-size:11px;padding:3px 8px;border-radius:4px;background:#E0E7FF;color:#1E40AF;font-weight:600;margin-left:8px;">—</span></h1>'
      +   '<span id="stkCount" class="text-muted" style="font-size:12px;margin-left:auto;">—</span>'
      + '</div>'
      + '<div class="pt-content__body">'
      +   '<div id="stkB1Preview" style="display:none;text-align:center;background:var(--bg-soft);padding:16px;border-radius:8px;margin-bottom:12px;">'
      +     '<div style="display:inline-block;background:#fff;padding:8px;box-shadow:0 4px 12px rgba(0,0,0,.1);max-width:100%;">'
      +       '<canvas id="stkB1Canvas" style="display:block;border:1px dashed #ccc;max-width:100%;height:auto;"></canvas>'
      +     '</div>'
      +     '<div style="margin-top:10px;font-size:11px;color:var(--ink-3);">📌 Output PNG = 203 DPI ตามขนาดจริง</div>'
      +   '</div>'
      +   '<div id="stkSheet" class="sticker-sheet" style="display:none;"></div>'
      +   '<div class="panel" style="padding:12px;">'
      +     '<div id="stkToolbar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">'
      +       '<div id="stkLotPickerBox" style="display:none;align-items:center;gap:6px;flex:1;min-width:180px;">'
      +         '<label style="display:flex;align-items:center;gap:6px;width:100%;">Lot:'
      +           '<select id="stkLotSel" class="form-select form-select-sm" style="flex:1;"><option value="">— ไม่มี lot —</option></select>'
      +         '</label>'
      +       '</div>'
      +       '<label style="display:flex;align-items:center;gap:6px;">ขนาด:'
      +         '<select id="stkSize" class="form-select form-select-sm" style="width:auto;"><option value="50x30">50×30mm</option><option value="40x30">40×30mm (vial)</option></select>'
      +       '</label>'
      +       '<div id="stkCopiesBox" style="display:none;align-items:center;gap:6px;">'
      +         '<label style="display:flex;align-items:center;gap:6px;">ทำซ้ำ:'
      +           '<input id="stkCopies" type="number" min="1" max="100" value="1" class="form-control form-control-sm" style="width:70px;">'
      +         '</label>'
      +       '</div>'
      +       '<span style="flex:1;"></span>'
      +       '<button id="stkBtnDownload" class="btn btn-primary" style="display:none;"><i class="bi bi-download"></i> Download PNG</button>'
      +       '<button id="stkBtnPrint" class="btn btn-primary" style="display:none;"><i class="bi bi-printer"></i> Print / Save PDF</button>'
      +     '</div>'
      +     '<div id="stkHint" style="margin-top:8px;font-size:12px;color:var(--ink-3);">—</div>'
      +   '</div>'
      +   '<style>'
      +     '.sticker-sheet{width:210mm;background:white;padding:8.5mm 5mm;box-sizing:border-box;margin:0 auto;display:grid;grid-template-columns:repeat(4,50mm);gap:2mm 0;justify-content:center;border:1px dashed #ccc;}'
      +     '.sticker{width:50mm;height:30mm;padding:1.5mm;box-sizing:border-box;display:flex;align-items:stretch;gap:1.5mm;font-family:"Sarabun",sans-serif;page-break-inside:avoid;border:1px dashed #eee;overflow:hidden;position:relative;}'
      +     '.sticker .qr-img{flex:none;width:22mm;height:22mm;align-self:center;}'
      +     '.sticker .info{flex:1;min-width:0;overflow:hidden;display:flex;flex-direction:column;justify-content:center;gap:.6mm;padding-right:5mm;}'
      +     '.sticker .stk-code{font-weight:700;font-size:10pt;font-family:monospace;line-height:1.1;}'
      +     '.sticker .stk-name{font-size:7.5pt;line-height:1.15;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}'
      +     '.sticker .stk-meta{font-size:6.5pt;color:#666;line-height:1.1;}'
      +     '.sticker .stk-logo{position:absolute;top:1mm;right:1mm;width:4mm;height:4mm;opacity:.4;pointer-events:none;}'
      +     '.sticker .stk-logo img{width:100%;height:100%;object-fit:contain;}'
      +     '@media print{body.printing-stickers *{visibility:hidden;}body.printing-stickers .pt-content,body.printing-stickers .pt-content *{visibility:visible;}body.printing-stickers .pt-content{position:absolute;left:0;top:0;}body.printing-stickers .pt-content__topbar,body.printing-stickers .panel{display:none !important;}body.printing-stickers .sticker-sheet{border:none;margin:0;padding:8.5mm 5mm;}body.printing-stickers .sticker{border:none !important;}}'
      +     '@page{size:A4;margin:0;}'
      +   '</style>'
      + '</div>';

    root.querySelector('#stkSize').addEventListener('change', () => doRender(root));
    root.querySelector('#stkLotSel').addEventListener('change', () => doRender(root));
    root.querySelector('#stkCopies').addEventListener('change', () => doRender(root));
    root.querySelector('#stkBtnDownload').addEventListener('click', () => downloadPng(root));
    root.querySelector('#stkBtnPrint').addEventListener('click', printA4);

    load(root);
  };
})();
