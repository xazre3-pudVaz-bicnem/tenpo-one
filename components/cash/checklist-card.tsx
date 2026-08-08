/**
 * 開店チェックリスト・店舗日次締め実行前チェックの共通表示。
 * status='ok'(✓)/'warn'(要確認)/'info'(参考情報のみ・良否判定なし)。
 */
import Link from 'next/link';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type ChecklistStatus = 'ok' | 'warn' | 'info';

export interface ChecklistItem {
  key: string;
  label: string;
  /** 表示する値（例: '0件', '3/5台 開局中'） */
  valueLabel: string;
  status: ChecklistStatus;
  /** クリックで遷移する先。省略時はこのページ内の情報として非リンク表示 */
  href?: string;
}

const ICONS: Record<ChecklistStatus, typeof CheckCircle2> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  info: Info,
};

const ICON_CLASS: Record<ChecklistStatus, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  info: 'text-gray-400',
};

const VALUE_CLASS: Record<ChecklistStatus, string> = {
  ok: 'text-success',
  warn: 'font-semibold text-warning',
  info: 'text-gray-700',
};

export function ChecklistCard({
  title,
  description,
  items,
}: {
  title: string;
  description?: string;
  items: ChecklistItem[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <p className="mt-1 text-xs text-gray-500">{description}</p>}
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-gray-100">
          {items.map((item) => {
            const Icon = ICONS[item.status];
            const row = (
              <div className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="flex items-center gap-2.5">
                  <Icon className={cn('h-4 w-4 shrink-0', ICON_CLASS[item.status])} aria-hidden="true" />
                  <span className="text-sm text-gray-700">{item.label}</span>
                </span>
                <span className={cn('shrink-0 text-sm tabular-nums', VALUE_CLASS[item.status])}>{item.valueLabel}</span>
              </div>
            );
            return (
              <li key={item.key}>
                {item.href ? (
                  <Link href={item.href} className="block transition-colors hover:bg-gray-50">
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
