'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { markNotificationRead } from '@/app/app/actions';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export function NotificationRow({ notification: n }: { notification: NotificationItem }) {
  const handleClick = () => {
    if (!n.read_at) {
      // 既読化は結果を待たずに実行（画面遷移をブロックしない）
      void markNotificationRead(n.id);
    }
  };

  const content = (
    <div className={`flex gap-3 px-4 py-3 sm:px-5 ${!n.read_at ? 'bg-primary-soft' : ''}`}>
      <Bell className={`mt-0.5 h-4 w-4 shrink-0 ${!n.read_at ? 'text-primary' : 'text-gray-300'}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${!n.read_at ? 'font-semibold text-navy' : 'text-gray-700'}`}>{n.title}</p>
        {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{n.body}</p>}
        <p className="mt-1 text-[11px] text-gray-400">{formatDateTime(n.created_at)}</p>
      </div>
      {!n.read_at && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="未読" />}
    </div>
  );

  if (n.link) {
    return (
      <li>
        <Link href={n.link} onClick={handleClick} className="block hover:bg-gray-50">
          {content}
        </Link>
      </li>
    );
  }

  return (
    <li>
      <button type="button" onClick={handleClick} className="block w-full text-left hover:bg-gray-50">
        {content}
      </button>
    </li>
  );
}
