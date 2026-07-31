// ====================================================================
// แจ้งเตือนผ่าน Supwilai OS Notification API (PT-Amb worker)
// ====================================================================
// เขียนใหม่ 2026-07-31 — เดิมสคริปต์นี้ hardcode LINE channel token ไว้ในชีต
// แล้วยิง api.line.me เองตรงๆ ทำให้:
//   1) ไม่มีใครนับได้ว่ากินโควตา LINE ไปเท่าไหร่ (ก.ค. 2026 โควตาเต็ม 300/300
//      ทั้งบริษัทไม่ได้รับแจ้งเตือนหลายวันโดยไม่มีใครรู้ ไล่หาต้นตอไม่ได้)
//   2) ใครเปิดชีต → Extensions → Apps Script ก็ก๊อป token ไปยิงในนาม OA บริษัทได้
//   3) ไม่มีเพดาน ไม่หลีกทางให้เคสวิกฤต
//
// ตอนนี้: Form → Sheet → สคริปต์นี้ → /notify/event → Telegram/LINE
//   · token อยู่ที่ worker ที่เดียว (ในนี้เหลือแค่คีย์เรียก API ซึ่งสั่งได้แค่
//     "ส่งเข้ากลุ่มตัวเอง" ทำอย่างอื่นในนาม OA ไม่ได้)
//   · ทุกการส่งถูกบันทึกลง notification_log ก้อนเดียวกับ critical ของ PT
//   · ช่องทาง/เปิด-ปิด ปรับได้จาก settings ไม่ต้องกลับมาแก้ชีตอีก
//     NOTIFY_EXT_CHANNEL (ค่าเริ่มต้น telegram) · NOTIFY_EXT_EDIT_ENABLED (ค่าเริ่มต้น false)
//
// ⚠️ ห้ามเปลี่ยนชื่อ handleFormSubmit / handleEdit — trigger เดิมผูกกับชื่อนี้อยู่
// ====================================================================

const NOTIFY_URL    = 'https://gps-proxy.supwilai-ambulance.workers.dev/notify/event';
const NOTIFY_KEY    = '__EXTERNAL_NOTIFY_KEY__';
const NOTIFY_SOURCE = 'checklist';
const NOTIFY_TITLE  = 'คันที่ 2 4944 - Checklist EMT';

const SHEET_NAME = 'Form Responses 1';
const COLUMNS_TO_INCLUDE_IN_MESSAGE = [1, 2, 3, 4, 5, 6];

/**
 * ส่งข้อความผ่าน Supwilai OS Notification API — ไม่ throw เด็ดขาด
 * @param {string} message
 * @param {string} kind 'submit' = ส่งฟอร์มใหม่ · 'edit' = แก้เซลล์ย้อนหลัง
 */
function sendNotify(message, kind) {
  if (!message || message.trim() === '') return;
  try {
    const res = UrlFetchApp.fetch(NOTIFY_URL + '?key=' + encodeURIComponent(NOTIFY_KEY), {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ source: NOTIFY_SOURCE, message: message, kind: kind || 'submit' }),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      console.error('notify failed ' + code + ': ' + res.getContentText().slice(0, 300));
    }
  } catch (e) {
    console.error('notify error: ' + e.toString());
  }
}

function createSummaryMessage(rowData, headers) {
  let summary = '';
  COLUMNS_TO_INCLUDE_IN_MESSAGE.forEach(function (colNum) {
    const index = colNum - 1;
    if (index < headers.length && index < rowData.length) {
      const header = headers[index];
      const value = rowData[index];
      if (header && value) summary += `\n🔹 ${header}: ${value}`;
    }
  });
  return summary;
}

/** trigger: onFormSubmit */
function handleFormSubmit(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const summary = createSummaryMessage(e.values, headers);
    if (summary) sendNotify('📬 ' + NOTIFY_TITLE + '!!:\n\n--- สรุปข้อมูล ---' + summary, 'submit');
  } catch (error) {
    console.error('Error in handleFormSubmit: ' + error.toString());
  }
}

/** trigger: onEdit — worker เป็นคนตัดสินว่าจะส่งจริงไหม (ค่าเริ่มต้นปิด แต่ยัง log ไว้) */
function handleEdit(e) {
  try {
    const range = e.range;
    const sheet = range.getSheet();
    if (sheet.getName() !== SHEET_NAME || e.oldValue === e.value || range.getRow() === 1) return;

    const editedRow = range.getRow();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const rowData = sheet.getRange(editedRow, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    const summary = createSummaryMessage(rowData, headers);
    if (!summary) return;

    const userEmail = e.user ? e.user.email : 'Unknown User';
    sendNotify('✏️ ' + NOTIFY_TITLE + ' — แก้ไขแถวที่ ' + editedRow + '\n👤 โดย: ' + userEmail +
               '\n\n--- สรุปข้อมูล ---' + summary, 'edit');
  } catch (error) {
    console.error('Error in handleEdit: ' + error.toString());
  }
}
