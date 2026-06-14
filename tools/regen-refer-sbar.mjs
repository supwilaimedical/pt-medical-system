// regen-refer-sbar.mjs — one-time: re-summarize existing Refer AI summaries into SOAP format.
//
// Reads the real Refer documents (Cloudinary) for every case that already has
// raw_data.referSummary, runs Gemini OCR+SBAR via the OCR proxy (proxy holds the
// Gemini key — no key needed here), and writes the new SBAR summary back.
//
// Mirrors the browser pattern in v2/transport/index.html (_ocrSummarize +
// persistReferSummary). Run:  node tools/regen-refer-sbar.mjs
// Dry run (no DB write):       node tools/regen-refer-sbar.mjs --dry
//
// Requires Node 18+ (global fetch).

const DRY = process.argv.includes('--dry');

// ---- Config (from shared/config.js) ----
const SUPABASE_URL = 'https://rwxaalgvkzlsyfzdebcj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5jmlKl7w2H_Qb4Yp1Y8gWA_-SMZfB0a';
const OCR_PROXY = 'https://gps-proxy.supwilai-ambulance.workers.dev';
const ORIGIN = 'https://supwilaimedical.github.io'; // satisfies worker CORS allowlist

// ---- SBAR prompt (keep in sync with _ocrSummarize in v2/transport/index.html) ----
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
  '5. ชื่อโรงพยาบาล/สถานที่/บุคคล ถ้าอ่านไม่ชัดหรือไม่มั่นใจ ให้เขียน "(อ่านไม่ชัด)" — ห้ามเดาชื่อเด็ดขาด (รูปมักไม่ชัด)\n' +
  '6. ไม่ต้องระบุ "ส่งจาก/ส่งไป" (ต้นทาง-ปลายทาง) เว้นแต่เอกสารเขียนข้อมูลการส่งต่อไว้ชัดเจน (เช่น "Refer มาจาก รพ. ... วันที่ ...") จึงใส่ตามที่เขียนเป๊ะ\n' +
  '7. ภาษาไทย กระชับ อ่านง่าย\n\n' +
  'ตอบเป็น JSON เท่านั้น: { "summary": "<สรุป SOAP ภาษาไทย ขึ้นบรรทัดใหม่แต่ละหัวข้อ S/O/A/P>" }';

const sbHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
  'Content-Type': 'application/json'
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- doc → { mime, data(base64) } ----
function isPdfDoc(d) {
  return (d.type && /pdf/i.test(d.type)) ||
         /\.pdf(\?|#|$)/i.test(d.url || '') ||
         d.resourceType === 'raw' || d.format === 'pdf';
}

async function fetchDoc(d) {
  let url = d.url;
  const pdf = isPdfDoc(d);
  if (!pdf && url.indexOf('/upload/') !== -1) {
    // Cloudinary transform — shrink images (mirror browser _imageUrlToBase64)
    url = url.replace('/upload/', '/upload/w_2000,q_auto,f_jpg/');
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('fetch doc ' + resp.status + ' ' + url);
  const buf = Buffer.from(await resp.arrayBuffer());
  return { mime: pdf ? 'application/pdf' : 'image/jpeg', data: buf.toString('base64') };
}

// ---- Gemini via proxy: Pro ×3 (backoff) → flash ----
async function callModel(model, parts) {
  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      temperature: 0.2
    }
  };
  const resp = await fetch(OCR_PROXY + '/?model=' + encodeURIComponent(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify(body)
  });
  if (!resp.ok) { const t = await resp.text(); const e = new Error('HTTP ' + resp.status); e.status = resp.status; e.body = t; throw e; }
  const data = await resp.json();
  const pr = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const txt = (pr[0] || {}).text || '{}';
  return (JSON.parse(txt).summary || '').trim();
}

// Cloudflare gateway timeouts (524/522/408) won't improve by retrying Pro on
// big multi-page docs → drop to flash (faster, rarely times out) immediately.
const TIMEOUT_CODES = [524, 522, 408];
const RETRY_CODES = [429, 503, 500];

async function summarize(parts) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await callModel('gemini-2.5-pro', parts); }
    catch (e) {
      if (TIMEOUT_CODES.includes(e.status)) break;          // Pro too slow → flash now
      if (!RETRY_CODES.includes(e.status)) throw e;          // 400 etc → real error
      if (attempt < 3) await delay(attempt * 1500);
    }
  }
  return await callModel('gemini-2.5-flash', parts);
}

// ---- main ----
async function main() {
  console.log(DRY ? '== DRY RUN (no DB writes) ==' : '== LIVE RUN ==');

  // cases with an existing referSummary
  const q = SUPABASE_URL + '/rest/v1/cases?select=case_id,raw_data&raw_data->>referSummary=not.is.null';
  const resp = await fetch(q, { headers: sbHeaders });
  if (!resp.ok) throw new Error('select cases ' + resp.status + ' ' + (await resp.text()));
  const rows = await resp.json();
  console.log('Found ' + rows.length + ' case(s) with an AI summary.\n');

  let ok = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    const id = row.case_id;
    const rd = row.raw_data || {};
    let docs = [];
    try { docs = rd.referDocsJson ? JSON.parse(rd.referDocsJson) : []; } catch (e) {}
    docs = (docs || []).filter((d) => d && d.url);

    if (!docs.length) { console.log('SKIP  ' + id + ' — no refer docs to re-read'); skipped++; continue; }

    // Idempotency: skip cases already in SOAP format (re-run only retries failures)
    if (!DRY && typeof rd.referSummary === 'string' && rd.referSummary.trim().startsWith('S (Subjective)')) {
      console.log('SKIP  ' + id + ' — already SOAP'); skipped++; continue;
    }

    try {
      process.stdout.write('...   ' + id + ' — reading ' + docs.length + ' doc(s)... ');
      const parts = [{ text: PROMPT }];
      for (const d of docs) {
        const pg = await fetchDoc(d);
        parts.push({ inline_data: { mime_type: pg.mime, data: pg.data } });
      }
      const summary = await summarize(parts);
      if (!summary) throw new Error('empty summary');

      if (DRY) {
        console.log('OK (dry)\n----- ' + id + ' -----\n' + summary + '\n');
        ok++;
        continue;
      }

      // read-merge-write (mirror persistReferSummary) — re-read fresh raw_data
      const cur = await fetch(SUPABASE_URL + '/rest/v1/cases?case_id=eq.' + encodeURIComponent(id) + '&select=raw_data', { headers: sbHeaders });
      const curRows = await cur.json();
      const freshRd = (curRows[0] && curRows[0].raw_data) || rd;
      freshRd.referSummary = summary;
      freshRd.referSummaryAt = new Date().toISOString();
      const upd = await fetch(SUPABASE_URL + '/rest/v1/cases?case_id=eq.' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ raw_data: freshRd })
      });
      if (!upd.ok) throw new Error('patch ' + upd.status + ' ' + (await upd.text()));
      console.log('OK');
      ok++;
    } catch (e) {
      console.log('FAIL — ' + (e.message || e) + (e.body ? (' | body: ' + String(e.body).slice(0, 300)) : ''));
      failed++;
    }
  }

  console.log('\nDone. ok=' + ok + ' skipped=' + skipped + ' failed=' + failed);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
