export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: '正社員',
  contract: '契約社員',
  part_time: 'アルバイト・パート',
  outsourced: '業務委託',
};

export const EMPLOYEE_STATUS_LABEL: Record<string, string> = {
  active: '在籍中',
  retired: '退職',
  deleted: '削除済み',
};

export const EMPLOYEE_STATUS_TONE: Record<string, 'success' | 'gray' | 'danger'> = {
  active: 'success',
  retired: 'gray',
  deleted: 'danger',
};
