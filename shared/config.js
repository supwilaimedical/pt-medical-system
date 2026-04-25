// PT Medical System — Configuration
// APP_VERSION: bump on every significant update + add entry in memory/version.md
window.APP_VERSION = '5.9.0';
window.APP_VERSION_DATE = '2026-04-22';

const CONFIG = {
  // ===== REQUIRED (cannot be moved to admin — bootstrap/auth) =====
  SUPABASE_URL: 'https://rwxaalgvkzlsyfzdebcj.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_5jmlKl7w2H_Qb4Yp1Y8gWA_-SMZfB0a',
  BASE_URL: '/pt-medical-system',
  // GAS Auth URL — NEVER expose in admin (breaks login if tampered)
  GAS_AUTH_API_URL: 'https://script.google.com/macros/s/AKfycbybpea7XetHbLnibNWUHV_Mg9CpmIWzXR_5lCKzPWoWUAjPcy-wUVAgAP_dWd0Avf4jug/exec',
  // GAS Fleet API URL — Ambulance Checklist data source (deploy WebApi.gs as Web App)
  // If empty, Fleet Status page shows mock data for testing.
  GAS_FLEET_API_URL: 'https://script.google.com/macros/s/AKfycbx6LtGWP0dkekS8cUZ1wchAZlnTHmj7AbpS2ieDu2SoH-HShBqHXfe5JTeF4fO6fRRU/exec',

  // ===== DEFAULTS (factory fallback — admin overrides in settings table) =====
  // Each value here is used when the matching DB row is missing.
  // Admin can clear the DB value → row stays with empty string = intentional disable (no fallback).
  // Admin can delete the DB row entirely → fallback to this default.
  DEFAULTS: {
    // Cloudinary — image CDN
    CLOUDINARY_CLOUD_NAME: 'deimrg3xs',
    CLOUDINARY_UPLOAD_PRESET: 'pt-medical',

    // GPS proxy chain (client-side; each can be toggled independently in admin)
    GPS_PROXY_SYNOLOGY: '',                                          // empty default — user must set NAS URL
    GPS_PROXY_RENDER:   'https://gps-proxy-lpdq.onrender.com',
    GPS_PROXY_GAS:      'https://script.google.com/macros/s/AKfycbxXbDS4vXO9v_q5bgyxv0WJeIR5CAr_6kZ-LrCINEFLFe1_VPV3Ls8geNv4jPT_FNPfNg/exec',
    // Per-proxy enable flags (string '1' | '0' to match settings table convention)
    GPS_PROXY_SYNOLOGY_ENABLED: '1',
    GPS_PROXY_RENDER_ENABLED:   '1',
    GPS_PROXY_GAS_ENABLED:      '1',

    // OCR Proxy (Cloudflare Worker hiding Gemini key)
    OCR_PROXY_URL: 'https://gps-proxy.supwilai-ambulance.workers.dev',

    // Notification proxy — same worker as OCR (reuse). Override only if hosting separately.
    NOTIFY_PROXY_URL: 'https://gps-proxy.supwilai-ambulance.workers.dev',
    NOTIFY_LINE_ENABLED:        'false',
    NOTIFY_LINE_TARGET_TYPE:    'broadcast',  // 'broadcast' | 'group' | 'user_list'
    NOTIFY_LINE_TARGETS:        '',
    NOTIFY_TELEGRAM_ENABLED:    'false',
    NOTIFY_TELEGRAM_CHAT_ID:    '',
    NOTIFY_EVENTS_ARREST:       'true',
    NOTIFY_EVENTS_SPO2_LOW:     'true',
    NOTIFY_EVENTS_HR_ABNORMAL:  'true',
    NOTIFY_EVENTS_RR_ABNORMAL:  'true',
    NOTIFY_EVENTS_BP_ABNORMAL:  'true',
    NOTIFY_EVENTS_GCS_LOW:      'true'
  }
};

// ===== Legacy aliases (for code that still reads CONFIG.GPS_PROXY_URL directly) =====
// These are populated at runtime by shared/settings.js after DB load.
// Before settings.js runs, they fall back to DEFAULTS to keep first-paint working.
CONFIG.GPS_PROXY_SYNOLOGY = CONFIG.DEFAULTS.GPS_PROXY_SYNOLOGY;
CONFIG.GPS_PROXY_URL      = CONFIG.DEFAULTS.GPS_PROXY_RENDER;
CONFIG.GPS_PROXY_FALLBACK = CONFIG.DEFAULTS.GPS_PROXY_GAS;
CONFIG.OCR_PROXY_URL      = CONFIG.DEFAULTS.OCR_PROXY_URL;
CONFIG.CLOUDINARY_CLOUD_NAME    = CONFIG.DEFAULTS.CLOUDINARY_CLOUD_NAME;
CONFIG.CLOUDINARY_UPLOAD_PRESET = CONFIG.DEFAULTS.CLOUDINARY_UPLOAD_PRESET;

window.CONFIG = CONFIG;
