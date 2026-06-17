const SETTINGS_KEY = 'receipt-ledger-settings';

export type OcrModelSize = 'PP-OCRv6_small' | 'PP-OCRv6_tiny';

export interface AppSettings {
  ocrModelSize: OcrModelSize;
}

const DEFAULTS: AppSettings = {
  ocrModelSize: 'PP-OCRv6_small',
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULTS };
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
