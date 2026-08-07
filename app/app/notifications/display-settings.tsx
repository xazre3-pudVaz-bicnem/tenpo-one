'use client';

import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { NotificationRow, type NotificationItem } from './notification-row';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';
import { notificationTypeLabel } from './labels';

const STORAGE_KEY = 'tenpo_notification_hidden_types_v1';

/**
 * 通知の表示設定（この端末のみ有効）。種別ごとの受信自体をON/OFFする配信設定は
 * profiles側に列が無いため今後対応とし、ここでは「表示/非表示」のローカル設定のみ提供する。
 */
function readStoredHidden(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

export function NotificationList({ notifications, typeOptions }: { notifications: NotificationItem[]; typeOptions: string[] }) {
  // 初期値はlazy初期化でlocalStorageから同期的に読み込む（サーバー側は空集合＝全件表示になる）
  const [hidden, setHidden] = useState<Set<string>>(readStoredHidden);
  const [open, setOpen] = useState(false);

  const toggle = (type: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const visible = notifications.filter((n) => !hidden.has(n.type));

  return (
    <div>
      {typeOptions.length > 0 && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" />
            表示設定
          </Button>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          title="表示する通知がありません"
          description={hidden.size > 0 ? '表示設定で一部の種別が非表示になっています' : undefined}
        />
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {visible.map((n) => (
            <NotificationRow key={n.id} notification={n} />
          ))}
        </ul>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="通知の表示設定">
        <p className="mb-3 text-xs text-gray-500">
          この端末でのみ有効な表示設定です。種別ごとに通知の受信自体をON/OFFする配信設定は今後対応予定です。
        </p>
        <div className="space-y-2">
          {typeOptions.map((t) => (
            <label key={t} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
              {notificationTypeLabel(t)}
              <input type="checkbox" checked={!hidden.has(t)} onChange={() => toggle(t)} className="h-4 w-4 rounded border-gray-300" />
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            閉じる
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
