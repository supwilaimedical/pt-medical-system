// gen-missing-refer.mjs — generate raw_data.referSummary (SOAP) for cases that
// HAVE refer documents attached but DON'T have an AI summary yet.
//
// Same OCR+SOAP pipeline as regen-refer-sbar.mjs / the in-app _ocrSummarize,
// but the inverse selection: only cases missing a referSummary.
//   node tools/gen-missing-refer.mjs --dry   (preview, no DB write)
//   node tools/gen-missing-refer.mjs         (live)
// Requires Node 18+ (global fetch).

const DRY = process.argv.includes('--dry');

const SUPABASE_URL = 'https://rwxaalgvkzlsyfzdebcj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5jmlKl7w2H_Qb4Yp1Y8gWA_-SMZfB0a';
const OCR_PROXY = 'https://gps-proxy.supwilai-ambulance.workers.dev';
const ORIGIN = 'https://supwilaimedical.github.io';

// SOAP prompt — kept identical to regen-refer-sbar.mjs / _ocrSummarize
const PROMPT =
  'คุณคือผู้ช่วยอ่านและสรุป "ใบ Refer / ใบส่งตัวผู้ป่วย" ภาษาไทย จากรูปเอกสารที่แนบมา (อาจมีหลายหน้า)\n\n' +
  'จัดผลสรุปเป็นรูปแบบ SOAP ครบ 4 หัวข้อตามนี้เป๊ะ (ขึ้นบรรทัดใหม่ทุกหัวข้อ ใช้หัวข้อตามนี้):\n' +
  'S (Subjective): ข้อมูลจากการบอกเล่า — อาการสำคัญ, ระยะเวลา/ประวัติการเจ็บป่วย, โรคประจำตัว ตามที่เอกสารระบุ\n' +
  'O (Objective): ข้อมูลเชิงประจักษ์ — สัญญาณชีพ, ผลตรวจร่างกาย, ผลแล็บ/ภาพถ่ายรังสี, การรักษาที่ให้มาก่อนส่ง\n' +
  'A (Assessment): การวินิจฉัย/การประเมินของแพทย์ผู้ส่ง (เฉพาะที่เขียนในเอกสาร)\n' +
  'P (Plan): แผนการรักษา / เหตุผลส่งต่อ / สิ่งที่ขอให้ปลายทางทำต่อ (เฉพาะที่เขียนในเอกสาร)\n\n' +
  'กฎเข้มงวด:\n' +
  '1. ถอดและสรุป "เฉพาะข้อมูลที่ปรากฏในเอกสาร" เท่านั้น ห้ามเติม เดา หรืออนุมานสิ่งที่ไม่มี\n' +
  '2. ช่อง A และ P ให้ถอด "เฉพาะข้อความที่แพทย์ผู้ส่งเขียนไว้เอง" เท่านั้น — ห้ามใส่ความเห็น/คำวินิจฉัย/คำแนะนำการรักษาของคุณเอง\n' +
  '3. หัวข้อใดเอกสารไม่ได้ระบุ ให้เขียน "(ไม่ระบุในเอกสาร)" ในหัวข้อนั้น — ห้ามเว้นว่าง ห้ามเดา\n' +
  '4. ห้ามใส่ชื่อ-สกุลผู้ป่วย (PII) — ใส่ได้แค่ อายุ/เพศ\n' +
  '5. ชื่อโรงพยาบาล: คงรูปตามเอกสาร — ถ้าเป็นตัวย่อให้คงตัวย่อไว้ ห้ามขยายเป็นชื่อเต็มเอง (กันเดาผิด + ประหยัด token). ยกเว้นกรณีเดียว: ถ้าเอกสารเขียน "สปร" หรือ "รพ.สปร" ให้เขียนเป็น "รพ.สวรรค์ประชารักษ์". ถ้าชื่ออ่านไม่ชัดหรือไม่มั่นใจ ห้ามเดาเด็ดขาด — ให้เขียนโดย "คงประเภทสถานที่ตามที่เอกสารระบุ" แล้วเติมบทบาท เช่น "โรงพยาบาลต้นทาง", "รพ.สต.ปลายทาง", "คลินิกต้นทาง", "ที่เกิดเหตุ" · ห้ามอนุมานว่าเป็นโรงพยาบาลถ้าเอกสารไม่ได้ระบุประเภท (ต้นทาง/ปลายทางอาจเป็น รพ.สต./คลินิก/ศูนย์/บ้าน/ที่เกิดเหตุ) — ถ้าระบุประเภทไม่ได้ ให้เขียน "สถานพยาบาลต้นทาง"/"สถานพยาบาลปลายทาง" · ส่วนชื่อบุคคลหรือสถานที่ที่ไม่ใช่สถานพยาบาลและอ่านไม่ชัด ให้เขียน "(อ่านไม่ชัด)"\n' +
  '6. ไม่ต้องระบุ "ส่งจาก/ส่งไป" (ต้นทาง-ปลายทาง) เว้นแต่เอกสารเขียนข้อมูลการส่งต่อไว้ชัดเจน (เช่น "Refer มาจาก รพ. ... วันที่ ...") จึงใส่ตามที่เขียนเป๊ะ\n' +
  '7. เขียนเป็น "ภาษาไทยเป็นหลัก" — แปลอาการ/ผลตรวจ/ข้อความที่เป็นภาษาอังกฤษให้เป็นไทยให้มากที่สุด (เช่น drowsy→ซึม, dyspnea→หายใจลำบาก, "no evidence of..."→"ไม่พบ...", "follow 1-step command"→"ทำตามคำสั่งง่ายๆ ได้") คงภาษาอังกฤษไว้ได้เฉพาะ: ชื่อยา, ชื่อโรค/การวินิจฉัยที่เป็นทางการ, ค่าแล็บ+หน่วย, และตัวย่อทางการแพทย์ที่แปลแล้วเสียความหมาย (ถ้าทำได้ให้มีคำไทยกำกับในวงเล็บ) กระชับ อ่านง่าย\n' +
  // กฎ 8 — self-check ก่อนตอบ · ต้องมีให้ตรงกับหน้าเว็บ (OS/pt/v2/transport/index.html)
  // เดิมมีแต่ในหน้าเว็บ ⇒ สรุปที่ generate ย้อนหลังด้วยเครื่องมือนี้จะคุณภาพต่ำกว่า (เพิ่ม 2026-07-31)
  '8. ตรวจทานก่อนตอบ: ไล่เช็ค "ชื่อโรงพยาบาล/สถานที่/บุคคลทุกชื่อ" ในสรุปของคุณอีกรอบ — ชื่อใดถอดตัวอักษรจากภาพตรงๆ ไม่ได้ (มาจากการเดา ความรู้ทั่วไป หรือชื่อที่คุ้นเคย) ให้แทนที่ก่อนตอบเสมอ: ถ้าเป็นสถานพยาบาล ใช้ "ประเภทตามที่เอกสารระบุ + บทบาท" (เช่น "โรงพยาบาลปลายทาง", "รพ.สต.ต้นทาง" · ไม่รู้ประเภทให้ใช้ "สถานพยาบาลต้นทาง"/"สถานพยาบาลปลายทาง") · ถ้าเป็นชื่ออื่น ใช้ "(อ่านไม่ชัด)"\n\n' +
  'ตอบเป็น JSON เท่านั้น: { "summary": "<สรุป SOAP ภาษาไทยเป็นหลัก ขึ้นบรรทัดใหม่แต่ละหัวข้อ S/O/A/P>" }';

const sbHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
  'Content-Type': 'application/json'
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function isPdfDoc(d) {
  return (d.type && /pdf/i.test(d.type)) ||
         /\.pdf(\?|#|$)/i.test(d.url || '') ||
         d.resourceType === 'raw' || d.format === 'pdf';
}
async function fetchDoc(d) {
  let url = d.url;
  const pdf = isPdfDoc(d);
  if (!pdf && url.indexOf('/upload/') !== -1) url = url.replace('/upload/', '/upload/w_2000,q_auto,f_jpg/');
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('fetch doc ' + resp.status + ' ' + url);
  const buf = Buffer.from(await resp.arrayBuffer());
  return { mime: pdf ? 'application/pdf' : 'image/jpeg', data: buf.toString('base64') };
}
async function callModel(model, parts) {
  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      temperature: 0.2
    }
  };
  let resp;
  try {
    resp = await fetch(OCR_PROXY + '/?model=' + encodeURIComponent(model), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify(body), signal: AbortSignal.timeout(75000)
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) { const te = new Error('client timeout'); te.status = 408; throw te; }
    throw err;
  }
  if (!resp.ok) { const t = await resp.text(); const e = new Error('HTTP ' + resp.status); e.status = resp.status; e.body = t; throw e; }
  const data = await resp.json();
  const pr = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  return (JSON.parse((pr[0] || {}).text || '{}').summary || '').trim();
}
const TIMEOUT_CODES = [524, 522, 408], RETRY_CODES = [429, 503, 500];
async function summarize(parts) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await callModel('gemini-2.5-pro', parts); }
    catch (e) {
      if (TIMEOUT_CODES.includes(e.status)) break;
      if (!RETRY_CODES.includes(e.status)) throw e;
      if (attempt < 3) await delay(attempt * 1500);
    }
  }
  return await callModel('gemini-2.5-flash', parts);
}

async function main() {
  console.log(DRY ? '== DRY RUN (no DB writes) ==' : '== LIVE RUN ==');
  // cases WITHOUT a referSummary (null or absent)
  const q = SUPABASE_URL + '/rest/v1/cases?select=case_id,raw_data&raw_data->>referSummary=is.null';
  const resp = await fetch(q, { headers: sbHeaders });
  if (!resp.ok) throw new Error('select cases ' + resp.status + ' ' + (await resp.text()));
  const rows = await resp.json();

  // keep only those that actually have refer docs to read
  const targets = [];
  for (const row of rows) {
    const rd = row.raw_data || {};
    let docs = []; try { docs = rd.referDocsJson ? JSON.parse(rd.referDocsJson) : []; } catch (e) {}
    docs = (docs || []).filter((d) => d && d.url);
    if (docs.length) targets.push({ id: row.case_id, rd, docs });
  }
  console.log('Found ' + targets.length + ' case(s) with refer docs but no AI summary.\n');

  let ok = 0, failed = 0;
  for (const t of targets) {
    try {
      process.stdout.write('...   ' + t.id + ' — reading ' + t.docs.length + ' doc(s)... ');
      const parts = [{ text: PROMPT }];
      for (const d of t.docs) { const pg = await fetchDoc(d); parts.push({ inline_data: { mime_type: pg.mime, data: pg.data } }); }
      const summary = await summarize(parts);
      if (!summary) throw new Error('empty summary');
      if (DRY) { console.log('OK (dry)\n----- ' + t.id + ' -----\n' + summary + '\n'); ok++; continue; }
      // read-merge-write fresh raw_data
      const cur = await fetch(SUPABASE_URL + '/rest/v1/cases?case_id=eq.' + encodeURIComponent(t.id) + '&select=raw_data', { headers: sbHeaders });
      const freshRd = ((await cur.json())[0] || {}).raw_data || t.rd;
      freshRd.referSummary = summary;
      freshRd.referSummaryAt = new Date().toISOString();
      const upd = await fetch(SUPABASE_URL + '/rest/v1/cases?case_id=eq.' + encodeURIComponent(t.id), {
        method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=minimal' }, body: JSON.stringify({ raw_data: freshRd })
      });
      if (!upd.ok) throw new Error('patch ' + upd.status + ' ' + (await upd.text()));
      console.log('OK'); ok++;
    } catch (e) { console.log('FAIL — ' + (e.message || e) + (e.body ? (' | ' + String(e.body).slice(0, 200)) : '')); failed++; }
  }
  console.log('\nDone. ok=' + ok + ' failed=' + failed);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
