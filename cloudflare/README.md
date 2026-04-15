# Cloudflare Workers

## 1. OCR Proxy (`ocr-proxy-worker.js`)

ซ่อน Gemini API key จาก browser + ให้ทุกเครื่อง/ทุก user ใช้ key กลางของหน่วยงานได้โดยไม่ต้องตั้งค่าเอง

### Architecture

```
Browser ──POST──▶ Cloudflare Worker ──POST──▶ Gemini API
        (no key)                    (with secret key)
```

### Deploy ครั้งแรก (~5 นาที)

#### 1. ติดตั้ง wrangler (ครั้งเดียวทั้งเครื่อง)
```bash
npm install -g wrangler
```

#### 2. Login Cloudflare
```bash
wrangler login
# → เปิด browser ให้ login + allow wrangler
```

#### 3. Deploy Worker
```bash
cd F:/@Coding/pt-medical-system/cloudflare
wrangler deploy
```

**ผลลัพธ์:** ได้ URL ประมาณ `https://pt-ocr-proxy.YOUR-ACCOUNT.workers.dev`  
**คัดลอก URL นี้ไว้** — จะใช้ step 5

#### 4. ตั้งค่า Gemini API Key เป็น secret
```bash
wrangler secret put GEMINI_API_KEY
# → จะถามให้ paste key → วาง AIzaSy... แล้ว Enter
```

**(Optional, Production)** จำกัด origin ที่ call ได้:
```bash
wrangler secret put ALLOWED_ORIGINS
# → paste: https://your-site.pages.dev,https://another-domain.com
```

#### 5. อัปเดต `shared/config.js`
```js
OCR_PROXY_URL: 'https://pt-ocr-proxy.YOUR-ACCOUNT.workers.dev'
```

เสร็จสิ้น — browser ทุกเครื่องจะใช้ proxy อัตโนมัติ ไม่ต้องใส่ API key เอง

---

### อัปเดต Worker (แก้ไข code)
```bash
cd F:/@Coding/pt-medical-system/cloudflare
wrangler deploy
```

### ดู log real-time
```bash
wrangler tail
# กด Ctrl+C เพื่อหยุด
```

### ลบ Worker
```bash
wrangler delete
```

---

### ค่าใช้จ่าย Cloudflare Workers (Free tier)

- 100,000 requests/วัน ฟรี
- 10ms CPU time ต่อ request (เราใช้ ~3-5ms ต่อการเรียก Gemini)
- เกินฟรี → $5/เดือน ได้ 10M requests + 30M CPU ms

**สำหรับ OCR ID card ใช้งานปกติ (EMS ~20-50 cases/วัน) = อยู่ใน free tier แน่นอน**

---

### Troubleshooting

**Q: `wrangler deploy` บอก "Not logged in"**  
A: รัน `wrangler login` ก่อน

**Q: Worker ตอบ "Server not configured"**  
A: ลืมตั้ง secret → รัน `wrangler secret put GEMINI_API_KEY`

**Q: Browser ตอบ "Origin not allowed"**  
A: ตรวจสอบ `ALLOWED_ORIGINS` หรือลบออก (ถ้าเป็น dev)

**Q: อยากเปลี่ยน Gemini key**  
A: รัน `wrangler secret put GEMINI_API_KEY` ใหม่ (จะเขียนทับของเดิม)

---

## 2. GPS Proxy (`gps-proxy-worker.js`)

GPS proxy สำหรับ CMSV6 API (ไม่ใช้ Gemini) — แก้ปัญหา Mixed Content HTTPS→HTTP  
ดู `shared/config.js` สำหรับ URL ปัจจุบัน (โฮสต์บน Render แทน Workers)
