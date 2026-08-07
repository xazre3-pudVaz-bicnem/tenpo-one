'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tr, Td } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { CorrectionDialog } from './correction-dialog';
import { EntryTypeDialog } from './entry-type-dialog';
import { EVENT_LABELS, type EntryType, type PunchEventType } from '@/app/app/attendance/actions';

const SOURCE_LABEL: Record<string, string> = {
  personal: '個人端末',
  shared_terminal: '共用端末（PIN）',
  manual: '手動登録',
};

export interface TimeEntryEventView {
  id: string;
  eventType: string;
  occurredAt: string;
  source: string;
  viaPin: boolean;
}

const ENTRY_TYPE_LABEL: Record<EntryType, string> = {
  normal: '通常',
  late: '遅刻',
  early_leave: '早退',
  absent: '欠勤',
  paid_leave: '有給',
  holiday_work: '休日出勤',
};

const ENTRY_TYPE_TONE: Record<EntryType, 'gray' | 'warning' | 'danger' | 'primary' | 'success'> = {
  normal: 'gray',
  late: 'warning',
  early_leave: 'warning',
  absent: 'danger',
  paid_leave: 'primary',
  holiday_work: 'success',
};

/** 勤怠一覧の1行。展開すると打刻イベントの生ログ（打刻履歴）を表示する。 */
export function AttendanceRow({
  id,
  workDateLabel,
  staffName,
  showStaffColumn,
  clockInLabel,
  clockOutLabel,
  breakMinutes,
  workedLabel,
  entryType,
  missing,
  status,
  locked,
  isApprover,
  storeId,
  profileId,
  workDate,
  timeEntryId,
  defaultClockIn,
  defaultClockOut,
  events,
}: {
  id: string;
  workDateLabel: string;
  staffName: string | null;
  showStaffColumn: boolean;
  clockInLabel: string;
  clockOutLabel: string;
  breakMinutes: number;
  workedLabel: string;
  entryType: EntryType;
  missing: boolean;
  status: string;
  locked: boolean;
  isApprover: boolean;
  storeId: string;
  profileId: string;
  workDate: string;
  timeEntryId: string;
  defaultClockIn: string;
  defaultClockOut: string;
  events: TimeEntryEventView[];
}) {
  const [open, setOpen] = useState(false);
  const columnCount = 8 + (showStaffColumn ? 1 : 0);

  return (
    <>
      <Tr key={id} className="hover:bg-gray-50">
        <Td className="w-8 px-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-navy"
            aria-label={open ? '打刻履歴を閉じる' : '打刻履歴を開く'}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </Td>
        <Td className="font-medium text-navy">{workDateLabel}</Td>
        {showStaffColumn && <Td>{staffName ?? '—'}</Td>}
        <Td>{clockInLabel}</Td>
        <Td>{clockOutLabel}</Td>
        <Td className="text-right tabular-nums">{breakMinutes}分</Td>
        <Td className="text-right tabular-nums">{workedLabel}</Td>
        <Td>
          <Badge tone={ENTRY_TYPE_TONE[entryType]}>{ENTRY_TYPE_LABEL[entryType]}</Badge>
        </Td>
        <Td>
          <div className="flex flex-wrap gap-1">
            {missing && (
              <Badge tone="danger" className="inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                打刻漏れ
              </Badge>
            )}
            {locked && (
              <Badge tone="navy" className="inline-flex items-center gap-1">
                <Lock className="h-3 w-3" />
                ロック
              </Badge>
            )}
            <Badge tone={status === 'approved' ? 'success' : status === 'closed' ? 'primary' : 'gray'}>
              {status === 'approved' ? '承認済' : status === 'closed' ? '打刻済' : '勤務中'}
            </Badge>
          </div>
        </Td>
        <Td className="text-right">
          {locked ? (
            <span className="text-xs text-gray-400">確定済みのため編集不可</span>
          ) : (
            <div className="flex flex-wrap justify-end gap-1.5">
              <CorrectionDialog
                storeId={storeId}
                profileId={profileId}
                workDate={workDate}
                timeEntryId={timeEntryId || null}
                defaultClockIn={defaultClockIn}
                defaultClockOut={defaultClockOut}
                defaultBreakMinutes={breakMinutes}
              />
              {isApprover && <EntryTypeDialog timeEntryId={timeEntryId} currentType={entryType} workDate={workDate} />}
            </div>
          )}
        </Td>
      </Tr>
      {open && (
        <Tr className="bg-gray-50/60">
          <Td colSpan={columnCount + 1} className="px-6 py-3">
            <p className="mb-2 text-xs font-semibold text-gray-500">打刻履歴（打刻イベントの生ログ）</p>
            {events.length === 0 ? (
              <p className="text-xs text-gray-400">打刻イベントの記録がありません（手動登録など）</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left">種別</th>
                      <th className="px-2 py-1.5 text-left">時刻</th>
                      <th className="px-2 py-1.5 text-left">端末</th>
                      <th className="px-2 py-1.5 text-left">PIN打刻</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {events.map((e) => (
                      <tr key={e.id}>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {EVENT_LABELS[e.eventType as PunchEventType] ?? e.eventType}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{formatDateTime(e.occurredAt)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{SOURCE_LABEL[e.source] ?? e.source}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{e.viaPin ? 'あり' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Td>
        </Tr>
      )}
    </>
  );
}
