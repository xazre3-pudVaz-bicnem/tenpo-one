import type { PunchEventType } from '@/app/app/attendance/actions';

/**
 * 打刻の種類の表示名。actions.ts（'use server'）に置くと、ルート（/api/app/v1/pos の iPad 勤怠）から読み込んだときに
 * 「'use server' ファイルは async 関数しか export できない」でビルドが失敗するため、ふつうのファイルに分ける（2026-10-25）。
 */
export const EVENT_LABELS: Record<PunchEventType, string> = {
  clock_in: '出勤',
  clock_out: '退勤',
  break_start: '休憩開始',
  break_end: '休憩終了',
};
