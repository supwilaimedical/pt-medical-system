# Fleet Status — GAS Web App Setup

หน้า Fleet Status ใน V2 ดึงข้อมูลจาก Google Sheets ของ Ambulance System ผ่าน GAS Web App endpoint

## Step 1: เพิ่มไฟล์ใหม่ใน Google Apps Script

เปิด GAS project ของ Ambulance System (`F:\@Coding\ระบบ\Ambulance System\Integrated`) → เพิ่ม script file ใหม่ชื่อ `WebApi.gs`:

```javascript
// ============================================================
// WebApi.gs - Public Web App endpoint for V2 Fleet Status
// Returns ambulance checklist data without auth (read-only)
// ============================================================

function doGet(e) {
  return doPost(e);
}

function doPost(e) {
  try {
    var params = {};
    if (e && e.postData && e.postData.contents) {
      try { params = JSON.parse(e.postData.contents); } catch(_){}
    }
    if (e && e.parameter) {
      Object.keys(e.parameter).forEach(function(k){ if (!(k in params)) params[k] = e.parameter[k]; });
    }

    var action = params.action || 'getAmbulanceData';

    if (action === 'getAmbulanceData') {
      return _jsonResponse({ status: 'success', data: _getAmbulanceDataPublic() });
    }

    return _jsonResponse({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return _jsonResponse({ status: 'error', message: err.message });
  }
}

function _getAmbulanceDataPublic() {
  // Same logic as Dashboard.gs::getAmbulanceData but no requireAuth()
  var allResults = [];
  for (var i = 0; i < CHECKLIST_SHEETS.length; i++) {
    try {
      var sheet = SpreadsheetApp.openById(CHECKLIST_SHEETS[i].id).getSheets()[0];
      var data = sheet.getDataRange().getDisplayValues();
      if (data.length > 1) {
        var headers = data[0];
        var rows = [];
        for (var r = 1; r < data.length; r++) {
          var obj = {};
          var rowIsEmpty = true;
          for (var c = 0; c < headers.length; c++) {
            obj[headers[c]] = data[r][c];
            if (data[r][c] !== "") rowIsEmpty = false;
          }
          if (!rowIsEmpty) rows.push(obj);
        }
        allResults.push({
          vehicle: CHECKLIST_SHEETS[i].vehicle,
          role: CHECKLIST_SHEETS[i].role,
          rows: rows
        });
      }
    } catch (e) {
      Logger.log("Error reading sheet " + CHECKLIST_SHEETS[i].id + ": " + e.message);
    }
  }
  return allResults;
}

function _jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## Step 2: Deploy as Web App

1. ใน GAS project → กด **Deploy** → **New deployment**
2. เลือก type: **Web app**
3. ตั้ง:
   - **Description:** `V2 Fleet API`
   - **Execute as:** Me (เจ้าของ Sheet)
   - **Who has access:** Anyone (public, no login)
4. กด **Deploy** → คัดลอก **Web App URL** ที่ได้

## Step 3: Set URL in `shared/config.js`

แก้ที่ `F:\@Coding\pt-medical-system\shared\config.js`:

```javascript
// GAS Fleet API URL
GAS_FLEET_API_URL: 'https://script.google.com/macros/s/XXX/exec',  // ← URL จาก Step 2
```

## Step 4: Test

เปิด `/v2/fleet/` → ควรเห็นข้อมูลจริงแทน mock

## Security Notes

- Endpoint นี้เป็น **read-only** (ไม่มี mutation)
- ไม่มี authentication → ใครรู้ URL ก็ดูได้
- ถ้าต้องการ private → เพิ่ม token check ใน `doPost()`:

```javascript
var TOKEN = 'your-secret-token-here';
if (params.token !== TOKEN) {
  return _jsonResponse({ status: 'error', message: 'Unauthorized' });
}
```

แล้ว V2 fetch ส่ง `body: JSON.stringify({ action:'getAmbulanceData', token:'...' })`
