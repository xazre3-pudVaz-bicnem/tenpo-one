/**
 * メニュー選択肢（オプション）の検証（純関数・テスト対象）。
 * 必須・最小/最大の選択数を検証し、レシート表記用のモディファイアと追加料金を返す。
 * DBアクセスは呼び出し側（app/app/pos/actions.ts）が行う。
 */

export interface OptionGroup {
  id: string;
  name: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
}

export interface OptionItem {
  id: string;
  name: string;
  /** 設定 > 選択肢 の英語名。厨房伝票に英語で出すために伝票へスナップショットする */
  nameEn?: string | null;
  price: number;
  groupId: string;
}

export interface ResolvedOptions {
  /** order_items.modifiers に保存する形。name_en は英語名がある選択肢だけに入る */
  modifiers: { name: string; name_en?: string; price: number }[];
  extraPrice: number;
}

/**
 * 選択内容を検証して確定する。問題があれば Error を投げる。
 * - selected は groups に属する選択肢のみであること（呼び出し側で取得済みの前提だが再確認する）
 * - 必須グループは最低1つ（min_select がそれ以上ならその数）選ぶこと
 * - 各グループの選択数は max_select 以下であること
 */
export function resolveOptionSelection(groups: OptionGroup[], selected: OptionItem[]): ResolvedOptions {
  if (groups.length === 0) {
    if (selected.length > 0) throw new Error('この商品に選択肢は設定されていません');
    return { modifiers: [], extraPrice: 0 };
  }

  const groupIds = new Set(groups.map((g) => g.id));
  if (selected.some((o) => !groupIds.has(o.groupId))) {
    throw new Error('選択された選択肢が正しくありません');
  }

  for (const g of groups) {
    const count = selected.filter((o) => o.groupId === g.id).length;
    const min = g.isRequired ? Math.max(1, g.minSelect) : g.minSelect;
    if (count < min) throw new Error(`「${g.name}」は${min}つ以上選んでください`);
    if (count > g.maxSelect) throw new Error(`「${g.name}」は${g.maxSelect}つまでしか選べません`);
  }

  // グループの並び順で安定させ、レシートの表示順を一定にする
  const order = new Map<string, number>(groups.map((g, i) => [g.id, i]));
  const sorted = [...selected].sort((a, b) => (order.get(a.groupId) ?? 0) - (order.get(b.groupId) ?? 0));

  return {
    modifiers: sorted.map((o) => {
      const nameEn = (o.nameEn ?? '').trim();
      // 英語名が無い／日本語と同じ選択肢には name_en を入れない（伝票側で日本語のみ印字される）
      return nameEn && nameEn !== o.name.trim()
        ? { name: o.name, name_en: nameEn, price: o.price }
        : { name: o.name, price: o.price };
    }),
    extraPrice: sorted.reduce((sum, o) => sum + o.price, 0),
  };
}
