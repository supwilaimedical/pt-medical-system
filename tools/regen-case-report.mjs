// regen-case-report.mjs — re-generate raw_data.caseSummary as a narrative Case Report.
// Mirrors the in-app case-summary logic in v2/transport/index.html (_buildCaseInput +
// CASE_PROMPT) but for the new Case-Report (narrative) prompt. Run:
//   node tools/regen-case-report.mjs            (regen all cases that have a caseSummary)
//   node tools/regen-case-report.mjs --dry      (preview, no DB write)
// Requires Node 18+.

const DRY = process.argv.includes('--dry');

const SUPABASE_URL = 'https://rwxaalgvkzlsyfzdebcj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5jmlKl7w2H_Qb4Yp1Y8gWA_-SMZfB0a';
const OCR_PROXY = 'https://gps-proxy.supwilai-ambulance.workers.dev';
const ORIGIN = 'https://supwilaimedical.github.io';

// Keep in sync with CASE_PROMPT in v2/transport/index.html
const PROMPT =
  'คุณคือผู้ช่วยเขียน "รายงานสรุปเคส (Case Report)" การนำส่งผู้ป่วยของทีมรถพยาบาล เป็นภาษาไทย\n' +
  'ข้อมูลด้านล่างมาจากระบบบันทึกเคส (บางคีย์เป็นภาษาอังกฤษ ให้ตีความตามบริบททางการแพทย์) และอาจมี "สรุปใบส่งตัวโดย AI" แนบมาด้วย\n\n' +
  'เขียนเป็น "รายงานเล่าเรื่องต่อเนื่อง (narrative)" อ่านลื่นเหมือน case report ทางการแพทย์ — ไม่ต้องใช้หัวข้อ SOAP/หัวข้อย่อย\n' +
  'เล่าตามลำดับธรรมชาติ: ผู้ป่วย (อายุ/เพศ) และเหตุที่นำส่ง → ภูมิหลัง/ประวัติ/โรคประจำตัว (อ้างอิง+ผนวกเนื้อหาจากสรุปใบส่งตัวที่ AI ทำมาด้วย) → อาการและสัญญาณชีพแรกรับ → เหตุการณ์ระหว่างนำส่ง: การรักษา/หัตถการ/ยา-สารน้ำที่ทีมให้ (เรียงตามเวลา), ภาวะหัวใจหยุดเต้น/CPR ถ้ามี → ภาวะ/การวินิจฉัย → การส่งมอบที่ปลายทาง/ผลลัพธ์\n\n' +
  'กฎเข้มงวด:\n' +
  '1. เขียนจาก "ข้อมูลที่ให้เท่านั้น" ห้ามเดา/เติม/อนุมาน ส่วนใดไม่มีข้อมูลให้ข้ามไป (ไม่ต้องเขียนว่าไม่มี)\n' +
  '2. ให้ "อ้างอิงและผนวกเนื้อหาจากสรุปใบส่งตัว" เข้ากับเรื่องเล่าอย่างกลมกลืน (ไม่ต้องแยกว่าส่วนไหนมาจากใบส่งตัว)\n' +
  '3. ภาษาไทยเป็นหลัก — แปลศัพท์อังกฤษเป็นไทยให้มากที่สุด คงอังกฤษเฉพาะ ชื่อยา/ชื่อโรคทางการ/ค่าแล็บ+หน่วย (มีไทยกำกับในวงเล็บถ้าทำได้)\n' +
  '4. ห้ามใส่ชื่อ-สกุลผู้ป่วย — ใส่ได้แค่ อายุ/เพศ\n' +
  '5. กระชับ เป็นย่อหน้าอ่านง่าย ไม่เยิ่นเย้อ\n\n' +
  'ตอบเป็น JSON เท่านั้น: { "summary": "<รายงานสรุปเคส (Case Report) ภาษาไทยเป็นหลัก>" }';

const sbHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
  'Content-Type': 'application/json'
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function buildInput(row) {
  const pi = row.patient_info || {}, op = row.op_info || {}, rd = row.raw_data || {};
  let snapStr = '';
  try {
    const snap = rd.rawSnapshot ? JSON.parse(rd.rawSnapshot) : {};
    delete snap.pt_name; delete snap.pt_idcard; delete snap.caseId;
    snapStr = JSON.stringify(snap);
  } catch (e) { snapStr = String(rd.rawSnapshot || ''); }
  const parts = [];
  parts.push('ข้อมูลผู้ป่วย: อายุ ' + (pi.age || '-') + ' เพศ ' + (pi.gender || '-') +
             ' | ต้นทาง: ' + (pi.origin || '-') + ' → ปลายทาง: ' + (pi.destination || '-'));
  parts.push('ระดับความเร่งด่วน (triage): ' + (row.triage_level || '-') +
             ' | ทีม/รถ: ' + (op.level || '-') + ' ' + (op.unitNo || ''));
  parts.push('\n== ฟอร์มบันทึกเคส (rawSnapshot) ==\n' + snapStr);
  parts.push('\n== สัญญาณชีพ/Arrest log (vitals) ==\n' + (rd.vitalsJson || '[]'));
  parts.push('\n== สารน้ำ/ยา (IV) ==\n' + (rd.ivJson || '[]'));
  if (rd.referSummary) parts.push('\n== สรุปใบส่งตัว (refer) ==\n' + rd.referSummary);
  return parts.join('\n');
}

async function callModel(model, inputText) {
  const body = {
    contents: [{ parts: [{ text: PROMPT }, { text: inputText }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      temperature: 0.3
    }
  };
  let resp;
  try {
    resp = await fetch(OCR_PROXY + '/?model=' + encodeURIComponent(model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(75000)
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
async function summarize(inputText) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await callModel('gemini-2.5-pro', inputText); }
    catch (e) {
      if (TIMEOUT_CODES.includes(e.status)) break;
      if (!RETRY_CODES.includes(e.status)) throw e;
      if (attempt < 3) await delay(attempt * 1500);
    }
  }
  return await callModel('gemini-2.5-flash', inputText);
}

async function main() {
  console.log(DRY ? '== DRY RUN ==' : '== LIVE RUN ==');
  const q = SUPABASE_URL + '/rest/v1/cases?select=case_id,patient_info,op_info,triage_level,raw_data&raw_data->>caseSummary=not.is.null';
  const resp = await fetch(q, { headers: sbHeaders });
  if (!resp.ok) throw new Error('select ' + resp.status + ' ' + (await resp.text()));
  const rows = await resp.json();
  console.log('Found ' + rows.length + ' case(s) with a caseSummary.\n');

  let ok = 0, failed = 0;
  for (const row of rows) {
    const id = row.case_id;
    try {
      process.stdout.write('...   ' + id + ' ... ');
      const summary = await summarize(buildInput(row));
      if (!summary) throw new Error('empty summary');
      if (DRY) { console.log('OK (dry)\n----- ' + id + ' -----\n' + summary + '\n'); ok++; continue; }
      const cur = await fetch(SUPABASE_URL + '/rest/v1/cases?case_id=eq.' + encodeURIComponent(id) + '&select=raw_data', { headers: sbHeaders });
      const freshRd = ((await cur.json())[0] || {}).raw_data || row.raw_data || {};
      freshRd.caseSummary = summary;
      freshRd.caseSummaryAt = new Date().toISOString();
      const upd = await fetch(SUPABASE_URL + '/rest/v1/cases?case_id=eq.' + encodeURIComponent(id), {
        method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=minimal' }, body: JSON.stringify({ raw_data: freshRd })
      });
      if (!upd.ok) throw new Error('patch ' + upd.status + ' ' + (await upd.text()));
      console.log('OK'); ok++;
    } catch (e) { console.log('FAIL — ' + (e.message || e)); failed++; }
  }
  console.log('\nDone. ok=' + ok + ' failed=' + failed);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
