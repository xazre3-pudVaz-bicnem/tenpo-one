'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Trash2, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/format';
import { markAnnouncementRead, deleteAnnouncement } from './actions';

export interface AnnouncementItemData {
  id: string;
  title: string;
  body: string;
  isImportant: boolean;
  storeLabel: string;
  publishFrom: string | null;
  publishTo: string | null;
  createdAt: string;
  isRead: boolean;
  canDelete: boolean;
}

export function AnnouncementItem({ data }: { data: AnnouncementItemData }) {
  const [expanded, setExpanded] = useState(false);
  const [read, setRead] = useState(data.isRead);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const toggle = () => {
    setExpanded((v) => !v);
    if (!read) {
      setRead(true);
      void markAnnouncementRead(data.id);
    }
  };

  return (
    <li className={`px-5 py-4 ${data.isImportant ? 'bg-warning-soft/40' : ''}`}>
      <button type="button" onClick={toggle} className="flex w-full items-start justify-between gap-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {data.isImportant && (
              <Badge tone="danger">
                <AlertTriangle className="mr-1 h-3 w-3" />
                重要
              </Badge>
            )}
            {!read && <Badge tone="primary">未読</Badge>}
            <p className="truncate font-medium text-navy">{data.title}</p>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {data.storeLabel}｜{formatDate(data.createdAt)}
            {(data.publishFrom || data.publishTo) && (
              <>
                {' '}
                ｜公開: {data.publishFrom ? data.publishFrom.replaceAll('-', '/') : '—'} 〜 {data.publishTo ? data.publishTo.replaceAll('-', '/') : '—'}
              </>
            )}
          </p>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />}
      </button>
      {expanded && (
        <div className="mt-3 space-y-3">
          <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{data.body}</p>
          {data.canDelete && (
            <div className="flex justify-end">
              <Button size="sm" variant="danger" onClick={() => setConfirmOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                削除する
              </Button>
              <ConfirmDialog
                open={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                title="お知らせを削除"
                message="このお知らせを削除します。よろしいですか？"
                requireReason={false}
                onConfirm={async () => {
                  try {
                    await deleteAnnouncement(data.id);
                    toast('お知らせを削除しました');
                    router.refresh();
                  } catch (e) {
                    toast(e instanceof Error ? e.message : '削除に失敗しました', 'error');
                  }
                }}
              />
            </div>
          )}
        </div>
      )}
    </li>
  );
}
