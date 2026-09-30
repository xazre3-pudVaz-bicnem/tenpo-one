/**
 * レジクローズを忘れた店のレジ（iPad）に出すポップアップ（2026-09-30 Ronnie「レジを閉めていない店には、
 * 次の日もポップアップを。いちばんレジを担当した人の名前で」）。純粋関数・テスト対象。
 *
 * 出す条件は上の帯（components/cash/register-day-banner.tsx・lib/register-day.ts の dayBannerKind）と同じ：
 * 前の営業日のまま朝10時を過ぎた／2日以上前から開いたまま。
 * あて先は、その営業日に会計した伝票の担当者（orders.clerk_name）でいちばん件数の多い人。
 * 伝票が無ければ開局した担当者（register_sessions.opened_clerk_name）。
 */

export type CloseReminderKind = 'continuing' | 'stale';

/** いちばん多く出てくる担当者の名前（同じ件数なら先に出てきた人）。誰もいなければ null */
export function topClerkName(names: readonly (string | null | undefined)[]): { name: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const raw of names) {
    const name = (raw ?? '').trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: { name: string; count: number } | null = null;
  for (const [name, count] of counts) {
    if (!best || count > best.count) best = { name, count };
  }
  return best;
}

/** 'YYYY-MM-DD' → 'M/D' */
function md(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

export interface CloseReminderText {
  title: string;
  body: string;
}

/**
 * ポップアップの文。
 * @param date continuing は続けている営業日、stale は開いたままの一番古い営業日
 */
export function closeReminderText(kind: CloseReminderKind, date: string, clerkName: string | null): CloseReminderText {
  const who = clerkName ? `${clerkName}さん、` : '';
  if (kind === 'stale') {
    return {
      title: `${who}レジクローズがまだです`,
      body: `${md(date)} から開いたままのレジがあります。2日以上前なので、売上は今日の日付に入っています。すぐにレジ精算（レジクローズ）をしてください。`,
    };
  }
  return {
    title: `${who}レジクローズがまだです`,
    body: `${md(date)} の営業日のレジが閉まっていません。売上はまだ ${md(date)} の営業日に入っています。レジ精算（レジクローズ）をしてください。`,
  };
}

/** 出さない画面：注文（/app/pos）と、レジクローズ・開局の画面そのもの */
export function closeReminderHiddenOn(pathname: string): boolean {
  return (
    pathname === '/app/pos' ||
    pathname.startsWith('/app/pos/') ||
    pathname.startsWith('/app/cash/close') ||
    pathname.startsWith('/app/cash/open')
  );
}
