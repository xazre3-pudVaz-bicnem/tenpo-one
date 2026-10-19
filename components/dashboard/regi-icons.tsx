/**
 * レジ（iPad）のホームで使うアイコン（2026-10-19 Ronnie の新しいレイアウト。Apple の純正アプリのような描き方）。
 * 大きいボタンは色つきの角丸の四角に白で、左の列は白い四角に機能の色で描く。
 */
type IconProps = { className?: string; color?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** オーダー・会計（画面に伝票） */
export function OrderIcon({ className, color = '#fff' }: IconProps) {
  return (
    <svg {...base} stroke={color} strokeWidth={1.9} className={className}>
      <rect x="3" y="3.5" width="18" height="11" rx="2" />
      <path d="M8 18.5h8M12 14.5v4M7 8h4M7 11h7" />
    </svg>
  );
}

/** 店舗台帳（カレンダー） */
export function LedgerIcon({ className, color = '#fff' }: IconProps) {
  return (
    <svg {...base} stroke={color} strokeWidth={1.9} className={className}>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <g fill={color} stroke="none">
        <circle cx="8.5" cy="13.5" r="1" />
        <circle cx="12" cy="13.5" r="1" />
        <circle cx="15.5" cy="13.5" r="1" />
        <circle cx="8.5" cy="16.8" r="1" />
        <circle cx="12" cy="16.8" r="1" />
      </g>
    </svg>
  );
}

/** 即会計（昔のレジ。¥ は使わない＝お客様が「会計」と勘違いしないように。2026-10-19 Ronnie） */
export function CashRegisterIcon({ className, color = '#22a94c' }: IconProps) {
  return (
    <svg {...base} stroke={color} strokeWidth={1.8} className={className}>
      <rect x="12" y="2" width="7.5" height="3.8" rx="1" />
      <path d="M15.75 5.8v1.7M3.2 13l2.6-5.5h12.4L20.8 13" />
      <g fill={color} stroke="none">
        <rect x="7.2" y="9.2" width="1.7" height="1.2" rx=".35" />
        <rect x="10" y="9.2" width="1.7" height="1.2" rx=".35" />
        <rect x="12.8" y="9.2" width="1.7" height="1.2" rx=".35" />
        <rect x="15.6" y="9.2" width="1.7" height="1.2" rx=".35" />
        <rect x="6.5" y="11.2" width="1.7" height="1.2" rx=".35" />
        <rect x="9.4" y="11.2" width="1.7" height="1.2" rx=".35" />
        <rect x="12.3" y="11.2" width="1.7" height="1.2" rx=".35" />
        <rect x="15.2" y="11.2" width="2.4" height="1.2" rx=".35" />
      </g>
      <rect x="2.5" y="13" width="19" height="8" rx="1.6" />
      <path d="M2.5 16.6h19M10.3 18.9h3.4" />
    </svg>
  );
}

export function SlipIcon({ className, color = '#636366' }: IconProps) {
  return (
    <svg {...base} stroke={color} strokeWidth={2.1} className={className}>
      <path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z" />
      <path d="M9 8h6M9 11.5h6M9 15h3" />
    </svg>
  );
}

export function CashInOutIcon({ className, color = '#22a94c' }: IconProps) {
  return (
    <svg {...base} stroke={color} strokeWidth={2.1} className={className}>
      <path d="M8 20V5M4 9l4-4 4 4M16 4v15M12 15l4 4 4-4" />
    </svg>
  );
}

export function BillsIcon({ className, color = '#1f6fe0' }: IconProps) {
  return (
    <svg {...base} stroke={color} strokeWidth={2.1} className={className}>
      <path d="M3 4h2.5l2.2 11h10.6L20.5 7H7" />
      <circle cx="9" cy="19" r="1.4" />
      <circle cx="17" cy="19" r="1.4" />
    </svg>
  );
}

export function DrawerIcon({ className, color = '#1ea5c0' }: IconProps) {
  return (
    <svg {...base} stroke={color} strokeWidth={2.1} className={className}>
      <path d="M3 13l2.5-7h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 13h5l1.5 2.5h5L16 13h5" />
    </svg>
  );
}

export function CloseRegisterIcon({ className, color = '#1c1c1e' }: IconProps) {
  return (
    <svg {...base} stroke={color} strokeWidth={2.1} className={className}>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function StockIcon({ className, color = '#9a7148' }: IconProps) {
  return (
    <svg {...base} stroke={color} strokeWidth={2.1} className={className}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </svg>
  );
}

export function SettingsIcon({ className, color = '#636366' }: IconProps) {
  return (
    <svg {...base} stroke={color} strokeWidth={2.1} className={className}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

/** 下の数字（来店組数・客数・リピーター・当日ウォークイン） */
export function GroupsIcon({ className }: { className?: string }) {
  return (
    <svg {...base} stroke="#fff" strokeWidth={2.2} className={className}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20a6.5 6.5 0 0 0-4-6" />
    </svg>
  );
}

export function GuestIcon({ className }: { className?: string }) {
  return (
    <svg {...base} stroke="#fff" strokeWidth={2.2} className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

export function RepeatIcon({ className }: { className?: string }) {
  return (
    <svg {...base} stroke="#fff" strokeWidth={2.2} className={className}>
      <path d="M20 11a8 8 0 0 0-14.6-4.5L3 9M3 4v5h5M4 13a8 8 0 0 0 14.6 4.5L21 15M21 20v-5h-5" />
    </svg>
  );
}

export function WalkInIcon({ className }: { className?: string }) {
  return (
    <svg {...base} stroke="#fff" strokeWidth={2.2} className={className}>
      <circle cx="13" cy="4" r="2" />
      <path d="M10 21l2-6 3 3v3M8 12l2-4 4 1 2 3 3 1M10 8l-1 5" />
    </svg>
  );
}
