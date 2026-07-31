# สคริปต์ที่ฝังอยู่ในชีต (container-bound) — สำรองไว้ที่นี่

> สคริปต์พวกนี้ **ไม่โผล่ใน `clasp list` และ Drive API** เพราะเป็น container-bound
> เห็นได้ที่ https://script.google.com/home เท่านั้น (ไอคอนชีตสีเขียว ชื่อ "Untitled project")
> ⇒ ก่อนหน้านี้ไม่มีสำเนาอยู่ที่ไหนเลย ถ้าใครลบชีตทิ้งคือหายถาวร

## ที่มา (2026-07-31)

เดิมทุกตัว **hardcode LINE channel access token ไว้ในชีต** แล้วยิง `api.line.me` เองตรงๆ
ทำให้ ก.ค. 2026 โควตา LINE ของ OA "Supwilai Notify" เต็ม 300/300 จนทั้งบริษัทไม่ได้รับ
แจ้งเตือนหลายวัน **โดยไม่มีใครนับได้ว่าอะไรกินไปเท่าไหร่** เพราะไม่ได้ log ที่ไหนเลย

ตอนนี้เปลี่ยนเป็น: `Form → Sheet → Script → /notify/event (worker gps-proxy) → LINE/Telegram`
- token อยู่ที่ worker ที่เดียว · ในสคริปต์เหลือแค่คีย์เรียก API (secret `EXTERNAL_NOTIFY_KEY`)
- ทุกการส่งลง `notification_log` ก้อนเดียวกับ critical ของ PT (`alert_type='EXTERNAL'`)
- ได้ `checkLineQuotaGuard` ฟรี ⇒ เช็ครถหลีกทางให้เคสวิกฤตเมื่อโควตาเหลือ < 5%

## ตั้งค่าได้จาก settings (ไม่ต้องกลับมาแก้ชีต)

| key | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `NOTIFY_EXT_CHANNEL` | `both` | ส่งตามช่องที่เปิดไว้ในหน้า Admin · บังคับได้ด้วย `line` / `telegram` |
| `NOTIFY_EXT_EDIT_ENABLED` | `true` | แจ้งตอนแก้เซลล์ย้อนหลังด้วยไหม (ของเดิมแจ้ง) |
| `NOTIFY_EXT_CHECKLIST_ENABLED` | `true` | ปิดเช็ครถทั้งชุดได้ที่นี่ |
| `NOTIFY_EXT_LEAVEFORM_ENABLED` | `true` | ปิดฟอร์มลาเก่าได้ที่นี่ |

## รายการ (ห้ามเปลี่ยนชื่อฟังก์ชัน `handleFormSubmit` / `handleEdit` — trigger ผูกกับชื่อ)

| ไฟล์ | ข้อความ | scriptId | ชีตที่ฝังอยู่ |
|---|---|---|---|
| `veh1-driver.js` | คันที่ 1 4893 - Checklist คนขับรถ | `1Ykk3IFjGFL_ocDPy442pUI4Vd3QQWFoa_kpN0vmo8obPN4u7xZ-7tQFP` | `19mhsjhd8LS8QCmeH4T53F23ccK8PKR3aWYoR1CLotwY` |
| `veh1-emt.js` | คันที่ 1 4893 - Checklist EMT | `1JYlngetjfRLid8N7MEhP-D08WpAF_bNMaubVkVinhPMPKiuLY2ryRJAj` | `1O95sG0__ZuNc6b1EOVqZPlTxiblgOIyGJWQazgfi_jY` |
| `veh2-driver.js` | คันที่ 2 4944 - Checklist คนขับรถ | `1xoAbnBRgEewAbTMDgqUyra41Vpuf5SO3x1bbLPCPW880V7woQ-dXNA7L` | `1960h1UK74fG-JHFnBpjmUjgTNAnpCxhWyH9k6pszrUw` |
| `veh2-emt.js` | คันที่ 2 4944 - Checklist EMT | `1WrTbZ96tAVmcap15X26DzlwsP31C_c_UvmxURbzUv7h18CkPzlEEfw25` | `1oDUJXnGZiPKVPQuBivvffJjW58a2WvCuBWnKN0vkX3Q` |
| `veh3-driver.js` | คันที่ 3 หน้ายาว - Checklist คนขับรถ | `1uHzRZBHOQG9OPu6F9ZBkxJfgnDYs1gWSIFqoYEis-xg0MeqNCg_3dmfm` | `1-8wzsgv3Edwxl0Ii0jF71YwU-jqP7AGyWcBuz9qJD5I` |
| `veh3-emt.js` | คันที่ 3 หน้ายาว - Checklist EMT | `1keNnxrvFuB7RRoX1D-TN0EY_KLVkRFFI1yZRJt77csgsX1VS-JnugC7n` | `19Kc5GR1y-vdi-A5dqOvt3Jq1pC77u4jtDzMXM07GwAI` |
| `leave-form-legacy.js` | มีการลาเกิดขึ้น (ระบบลาเก่า) | `1WpgZfpPRyxqopxf1fZx9pq6zoI9mZYp8XRlw1nXdzkmCSNFDOdwVE-a4` | `1zlUqv8dCrZHOXhlN33Xg1HzlUIqlcyeNS_6V0IPZ0c4` |

## วิธีกู้คืน / แก้ไข

```bash
mkdir tmp && cd tmp
echo {"scriptId":"<scriptId จากตาราง>","rootDir":"."} > .clasp.json
npx clasp pull      # ดึงของจริงลงมา
npx clasp push -f   # ดันกลับขึ้นไป
```

⚠️ `__EXTERNAL_NOTIFY_KEY__` ในไฟล์นี้ถูกแทนที่ไว้ — ค่าจริงอยู่ใน Cloudflare secret
ของ worker `gps-proxy` (`wrangler secret list`) ต้องใส่ค่าจริงกลับก่อน push
