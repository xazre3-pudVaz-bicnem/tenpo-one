/**
 * レジ（registers）の表示名と「開局するレジ」の選び方（2026-09-28 Ronnie「開局の箱は1つだけ。プリンターの名前はいらない、
 * レシートプリンターは自動」）。純粋関数・テスト対象。
 *
 * 店のレジはプリンター設定から作られたものがあり、名前が「レジ\\tStar / MC3」「キッチンメイン\\tStar / MC3」のように
 * プリンターのメーカー・機種を含んでいる。画面と紙では名前の本体だけを出す。
 */

/** 「レジ\\tStar / MC3」→「レジ」。タブ、または末尾の「 Star / …」「 EPSON / …」を落とす */
export function cleanRegisterName(name: string): string {
  const cut = name.split('\t')[0];
  return cut.replace(/\s+(Star|EPSON|Epson|Seiko|Citizen|Brother)\s*\/.*$/i, '').trim() || name.trim();
}

export interface RegisterLike {
  id: string;
  name: string;
  createdAt?: string | null;
}

/**
 * 開局の箱を1つだけ出すときの「その店のレジ」。
 * 名前が「レジ」で始まるものを優先し、無ければ一番古いもの。1台も無ければ null
 */
export function pickMainRegister<T extends RegisterLike>(registers: T[]): T | null {
  if (registers.length === 0) return null;
  const byCreated = [...registers].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  return byCreated.find((r) => /^レジ/.test(cleanRegisterName(r.name))) ?? byCreated[0];
}
