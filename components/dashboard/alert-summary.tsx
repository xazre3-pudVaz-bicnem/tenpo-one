'use client';

/**
 * ダッシュボード用アラートの集約サマリーバー。
 * 縦積み列挙ではなく1本のバーに集約し、重要度順（danger→warning）の上位3件をコンパクト表示。
 * 残りは「すべて表示」トグルでインライン展開する（computedアラートは通知センターに実体が無いため）。
 */
import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DashboardAlert } from './alerts';

const SEVERITY_ORDER: Record<DashboardAlert['tone'], number> = { danger: 0, warning: 1 };
const TOP_N = 3;

export function AlertSummary({ alerts }: { alerts: DashboardAlert[] }) {
  const [expanded, setExpanded] = useState(false);
  if (alerts.length === 0) return null;

  const sorted = [...alerts].sort((a, b) => SEVERITY_ORDER[a.tone] - SEVERITY_ORDER[b.tone]);
  const dangerCount = sorted.filter((a) => a.tone === 'danger').length;
  const warningCount = sorted.length - dangerCount;
  const barTone: 'danger' | 'warning' = dangerCount > 0 ? 'danger' : 'warning';
  const top = sorted.slice(0, TOP_N);
  const rest = sorted.slice(TOP_N);

  return (
    <div
      className={cn(
        'mb-5 rounded-xl border px-4 py-3',
        barTone === 'danger' ? 'border-danger/20 bg-danger-soft' : 'border-warning/20 bg-warning-soft'
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold',
            barTone === 'danger' ? 'text-danger' : 'text-warning'
          )}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          要対応 {sorted.length}件
          {dangerCount > 0 && warningCount > 0 && (
            <span className="text-xs font-normal opacity-70">
              （緊急{dangerCount}・注意{warningCount}）
            </span>
          )}
        </span>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
          {top.map((a) => (
            <Link
              key={a.id}
              href={a.href}
              className={cn(
                'truncate text-xs font-medium hover:underline',
                a.tone === 'danger' ? 'text-danger' : 'text-warning'
              )}
            >
              {a.title}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          {rest.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-0.5 text-xs font-medium text-gray-600 hover:text-navy"
            >
              {expanded ? 'たたむ' : `すべて表示 (${sorted.length})`}
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
          <Link href="/app/notifications" className="whitespace-nowrap text-xs font-medium text-gray-600 hover:text-navy hover:underline">
            通知センターへ
          </Link>
        </div>
      </div>

      {expanded && rest.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-white/60 pt-2">
          {rest.map((a) => (
            <li key={a.id}>
              <Link
                href={a.href}
                className={cn('text-xs font-medium hover:underline', a.tone === 'danger' ? 'text-danger' : 'text-warning')}
              >
                {a.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
