/**
 * GPS Proxy — Google Apps Script
 * ใช้เป็น HTTPS proxy สำหรับเรียก CMSV6 API (HTTP)
 * แก้ปัญหา Mixed Content บน GitHub Pages (HTTPS → HTTP blocked)
 *
 * วิธี Deploy:
 * 1. เปิด https://script.google.com → สร้าง Project ใหม่
 * 2. วาง code นี้ทั้งหมด
 * 3. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy URL → ใส่ใน Admin GPS Settings เป็น "Proxy URL"
 *    หรือเก็บใน shared/config.js เป็น GPS_PROXY_URL
 */

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    var params = e.parameter;
    var targetUrl = params.url;

    if (!targetUrl) {
      return jsonResponse({ error: 'Missing "url" parameter' }, 400);
    }

    // Security: only allow CMSV6 API endpoints
    if (!isAllowedUrl(targetUrl)) {
      return jsonResponse({ error: 'URL not allowed' }, 403);
    }

    // Forward the request to CMSV6
    var options = {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true
    };

    var response = UrlFetchApp.fetch(targetUrl, options);
    var content = response.getContentText();
    var code = response.getResponseCode();

    // Try to parse as JSON
    try {
      var jsonData = JSON.parse(content);
      return jsonResponse(jsonData, code);
    } catch(e) {
      // Return raw text if not JSON
      return ContentService.createTextOutput(content)
        .setMimeType(ContentService.MimeType.TEXT);
    }

  } catch(err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

/**
 * Security: only allow known CMSV6 API patterns
 */
function isAllowedUrl(url) {
  // Allow StandardApiAction endpoints (login, queryUserVehicle, getDeviceStatus)
  var allowedPatterns = [
    /StandardApiAction_login\.action/,
    /StandardApiAction_queryUserVehicle\.action/,
    /StandardApiAction_getDeviceStatus\.action/
  ];

  for (var i = 0; i < allowedPatterns.length; i++) {
    if (allowedPatterns[i].test(url)) return true;
  }
  return false;
}

function jsonResponse(data, code) {
  var output = ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}
