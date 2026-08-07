export const MANUAL_CATEGORIES = ['service', 'hygiene', 'cooking', 'register', 'attendance', 'emergency', 'other'] as const;
export type ManualCategory = (typeof MANUAL_CATEGORIES)[number];

export const MANUAL_CATEGORY_LABELS: Record<ManualCategory, string> = {
  service: '接客',
  hygiene: '衛生',
  cooking: '調理',
  register: 'レジ',
  attendance: '勤怠',
  emergency: '緊急対応',
  other: 'その他',
};

export function extFromFile(file: File): string {
  const parts = file.name.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'bin';
}

const ACCEPTED_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
export const MANUAL_FILE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';
const MAX_SIZE = 20 * 1024 * 1024;

export function validateManualFile(file: File): string | null {
  if (!ACCEPTED_MIME.includes(file.type)) return '対応形式は PDF・PNG・JPEG・WebP です';
  if (file.size > MAX_SIZE) return 'ファイルサイズは20MBまでです';
  return null;
}
