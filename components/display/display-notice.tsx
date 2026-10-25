import { CircleAlert, MonitorOff, WifiOff, Loader2, Unplug } from 'lucide-react';
import type { DisplayNoticeIcon } from '@/lib/display-monitor';

export type { DisplayNoticeIcon } from '@/lib/display-monitor';

const ICONS = {
  network: WifiOff,
  off: CircleAlert,
  revoked: Unplug,
  loading: Loader2,
  unpaired: MonitorOff,
} as const;

/**
 * ディスプレイ端末の全画面の案内（回線の外・機能 OFF・解除済み・未登録・接続確認中）。
 * 遠くからでも読めるよう大きく出す。読み直しは DisplayShell が行う。
 */
export function DisplayNotice({
  icon,
  title,
  body,
  footer,
}: {
  icon: DisplayNoticeIcon;
  title: string;
  body?: string;
  footer?: string;
}) {
  const Icon = ICONS[icon];
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#292725] px-6 text-center text-white">
      <Icon className={`h-16 w-16 text-white/80 ${icon === 'loading' ? 'animate-spin' : ''}`} aria-hidden />
      <h1 className="mt-6 max-w-3xl text-[clamp(1.75rem,4.5vw,3.25rem)] font-bold leading-tight">{title}</h1>
      {body && <p className="mt-4 max-w-2xl whitespace-pre-line text-[clamp(1rem,2vw,1.35rem)] text-white/75">{body}</p>}
      {footer && <p className="mt-10 text-sm text-white/45">{footer}</p>}
    </div>
  );
}
