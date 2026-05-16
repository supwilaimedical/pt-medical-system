// Backoffice (DMS + Stock) — Configuration
window.BO_VERSION = '1.0.0';
window.BO_VERSION_DATE = '2026-05-16';

const BO_CONFIG = {
  // BASE URL
  BASE_URL: '/pt-medical-system/backoffice',

  // ===== AUTH — same GAS HR endpoint as PT-Amb =====
  GAS_AUTH_API_URL: 'https://script.google.com/macros/s/AKfycbybpea7XetHbLnibNWUHV_Mg9CpmIWzXR_5lCKzPWoWUAjPcy-wUVAgAP_dWd0Avf4jug/exec',

  // ===== DMS + STOCK API (existing GAS web app deployment, do not change) =====
  // All data ops, PDF save/get, audit, atomic stock RPCs go through this endpoint.
  GAS_API_URL: 'https://script.google.com/macros/s/AKfycbxfUwR6p0WJ52mTWMGG51K8E_YVWhfj73K_iU8Yi-9zT9jqvG3l0_syI6TDZ-d5ZxcCFQ/exec',

  // Session storage key (separate from PT-Amb pt_user_meta)
  SESSION_KEY: 'bo_user_meta',
  SESSION_TIMEOUT_MS: 8 * 60 * 60 * 1000  // 8 hours
};
window.BO_CONFIG = BO_CONFIG;
