'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Tr, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';

export interface AuditLogRow {
  id: string;
  createdAt: string;
  actorName: string;
  actorRole: string | null;
  action: string;
  targetTable: string | null;
  targetId: string | null;
  beforeData: unknown;
  afterData: unknown;
  note: string | null;
}

export function AuditRow({ row }: { row: AuditLogRow }) {
  const [open, setOpen] = useState(false);
  const hasDetail = row.beforeData != null || row.afterData != null || !!row.note;

  return (
    <>
      <Tr
        className={hasDetail ? 'cursor-pointer' : undefined}
        onClick={() => hasDetail && setOpen((v) => !v)}
      >
        <Td className="whitespace-nowrap">
          {hasDetail && (open ? <ChevronDown className="mr-1 inline h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="mr-1 inline h-3.5 w-3.5 text-gray-400" />)}
          {formatDateTime(row.createdAt)}
        </Td>
        <Td>
          {row.actorName}
          {row.actorRole && <span className="ml-1 text-xs text-gray-400">({row.actorRole})</span>}
        </Td>
        <Td>
          <Badge tone="primary">{row.action}</Badge>
        </Td>
        <Td>{row.targetTable ?? '—'}</Td>
        <Td className="max-w-[12rem] truncate text-xs text-gray-500">{row.targetId ?? '—'}</Td>
      </Tr>
      {open && hasDetail && (
        <tr>
          <td colSpan={5} className="bg-gray-50 px-4 py-4">
            {row.note && <p className="mb-2 text-sm text-gray-700">メモ: {row.note}</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold text-gray-500">変更前</p>
                <pre className="max-h-64 overflow-auto rounded-lg bg-white p-3 text-xs text-gray-700 ring-1 ring-gray-200">
                  {row.beforeData != null ? JSON.stringify(row.beforeData, null, 2) : '—'}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-gray-500">変更後</p>
                <pre className="max-h-64 overflow-auto rounded-lg bg-white p-3 text-xs text-gray-700 ring-1 ring-gray-200">
                  {row.afterData != null ? JSON.stringify(row.afterData, null, 2) : '—'}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
