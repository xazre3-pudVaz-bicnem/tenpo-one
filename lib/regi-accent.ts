/**
 * レジ（iPad）の画面ごとの色（2026-10-20 Ronnie「中の画面もホームのボタンと同じ色に。オーダー・会計は青、即会計は緑…」）。
 * ホームのアイコンの色（components/dashboard/regi-home.tsx・regi-tools.tsx）と同じ色を、その画面のボタン・合計・選択中の色にする。
 * 色そのものは app/globals.css の [data-regi-accent] で、--color-iris / --color-primary などを入れ替える。
 * パソコン・ハンディは今まで通り（ContentArea がレジのときだけ data-regi-accent を付ける）。
 */
export type RegiAccent = 'order' | 'ledger' | 'quick' | 'slips' | 'cash' | 'bills' | 'close' | 'stock' | 'settings';

/** 前方一致。長い（細かい）パスを先に書く */
const ROUTES: [string, RegiAccent][] = [
  ['/app/cash/close', 'close'],
  ['/app/cash/open', 'close'],
  ['/app/cash', 'cash'],
  ['/app/floor', 'order'],
  ['/app/pos', 'order'],
  ['/app/reservations', 'ledger'],
  ['/app/quick-pay', 'quick'],
  ['/app/orders', 'slips'],
  ['/app/expenses', 'bills'],
  ['/app/scan', 'bills'],
  ['/app/invoices', 'bills'],
  ['/app/inventory', 'stock'],
  ['/app/settings', 'settings'],
];

export function regiAccentFor(pathname: string): RegiAccent | null {
  for (const [prefix, accent] of ROUTES) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return accent;
  }
  return null;
}
