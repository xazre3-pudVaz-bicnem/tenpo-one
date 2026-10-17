/**
 * カテゴリの中の商品を「銘柄（ブランド）ごとの見出し＋その下に種類」にまとめる。純関数・テスト対象。
 *
 * 2026-10-18 Ronnie「ウイスキーの中に White Horse・Johnnie Walker… がたくさんあると探しにくい。
 * White Horse —— Rock・Highball…、少し間をあけて Johnnie Walker —— …のように。ウイスキーだけでなく
 * 全部のカテゴリで。見出しの下に商品をぎっしり。QR でもハンディでも」。
 *
 * まとめ方（設定は要らない。商品名から自動で決める）
 * 1) 商品名に空白があるもの：最初の空白の前が見出し、後ろが種類
 *    「ホワイトホース ロック」「ホワイトホース ハイボール」→ ホワイトホース —— ロック・ハイボール
 *    「麦焼酎（A） 水割り」「和牛炙り寿司 4貫」も同じ。
 * 2) 空白の無いもの：英語名の最初の単語が同じで、日本語名の頭が2文字以上同じもの
 *    「カシスソーダ／Cassis Soda」「カシスオレンジ／Cassis Orange」→ カシス（Cassis）—— ソーダ・オレンジ
 *    英語名の確認を入れるのは「ライムサワー」「ライチサワー」（頭の「ライ」が同じ）を間違ってまとめないため。
 * - 同じ見出しが2つ以上あるときだけまとめる。1つだけのものは今までどおりの大きいタイル。
 * - 飲み放題の印「F. 」は見出し・種類の判定では無視する（「F. 焼酎 ロック」→ 焼酎 —— ロック）。
 * - 並びはメニューの順番のまま。まとめた商品は、その見出しの最初の商品の位置にそろえる。
 * - 1つもまとまらなければ null（呼び出し側は今までどおり全部を大きいタイルで出す）。
 *
 * カートに入る商品・伝票の名前は変えない（画面の出し方だけ）。
 */

export interface MenuGroupNames {
  /** 商品名（日本語） */
  name: string;
  /** 英語名（無ければ null） */
  nameEn?: string | null;
}

export interface MenuGroupMember<T> {
  item: T;
  /** 種類（日本語）。例：ロック */
  label: string;
  /** 種類（英語）。英語名が無い商品は null。例：Rock */
  labelEn: string | null;
}

export type MenuGroupSection<T> =
  | {
      kind: 'group';
      key: string;
      /** 見出し（日本語）。例：ホワイトホース */
      label: string;
      /** 見出し（英語）。作れなければ null。例：White Horse */
      labelEn: string | null;
      members: MenuGroupMember<T>[];
    }
  | {
      /** まとまらなかった商品（今までどおりのタイルで出す） */
      kind: 'items';
      key: string;
      items: T[];
    };

export interface GroupMenuOptions<T> {
  /** まとめてよい商品か（例：お客様QR で写真のある商品は写真つきのカードのまま出す）。無ければ全部 */
  groupable?: (item: T) => boolean;
}

/** 飲み放題の中身などに付く印（「F. 」）。英字1〜3文字＋ピリオド */
const MARKER = /^[A-Za-z]{1,3}\.\s*/;
const SPACES = /[\s　]+/;
/** 種類の頭に残ると読みにくい文字（「エビのアヒージョ」→「アヒージョ」） */
const LEAD_JUNK = /^[の・／/\s　]+/;
const TRAIL_JUNK = /[の・／/\s　]+$/;
/** 見出しの切れ目にできない文字（ここで切ると言葉の途中になる） */
const NO_BREAK_BEFORE = /[ーァィゥェォャュョッぁぃぅぇぉゃゅょっ゛゜]/;

interface Prepared {
  index: number;
  ja: string;
  en: string | null;
  enWords: string[];
}

function prepare(names: MenuGroupNames, index: number): Prepared {
  const rawJa = names.name.trim();
  const marked = MARKER.test(rawJa) && rawJa.replace(MARKER, '').trim().length > 0;
  const ja = marked ? rawJa.replace(MARKER, '').trim() : rawJa;
  const rawEn = (names.nameEn ?? '').trim();
  let en: string | null = rawEn && rawEn !== rawJa ? rawEn : null;
  // 英語名の印は、日本語名にも同じ印があるときだけ外す（「St. Germain」のような名前は残す）
  if (en && marked && MARKER.test(en)) en = en.replace(MARKER, '').trim() || null;
  return { index, ja, en, enWords: en ? en.split(SPACES).filter(Boolean) : [] };
}

/** 英語名の頭で全員に共通する単語（各商品に1語以上残す）。無ければ空 */
function commonLeadingWords(members: Prepared[]): string[] {
  if (members.some((m) => m.enWords.length < 2)) return [];
  const max = Math.min(...members.map((m) => m.enWords.length)) - 1;
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    const w = members[0].enWords[i];
    if (members.every((m) => m.enWords[i].toLowerCase() === w.toLowerCase())) out.push(w);
    else break;
  }
  return out;
}

/** 日本語名の共通の頭（言葉・数字の途中で切らない） */
function commonPrefix(names: string[]): string {
  let n = Math.min(...names.map((s) => s.length));
  for (let i = 0; i < n; i++) {
    const c = names[0][i];
    if (names.some((s) => s[i] !== c)) {
      n = i;
      break;
    }
  }
  // 「10貫」「12貫」の「1」や、「ー」「ッ」の前で切らない
  while (n > 0) {
    const next = names.map((s) => s[n] ?? '');
    const lastIsDigit = /[0-9０-９]/.test(names[0][n - 1]);
    if (next.some((c) => NO_BREAK_BEFORE.test(c)) || (lastIsDigit && next.some((c) => /[0-9０-９]/.test(c)))) {
      n--;
      continue;
    }
    break;
  }
  return names[0].slice(0, n);
}

interface Candidate {
  key: string;
  label: string;
  members: { p: Prepared; label: string }[];
}

/**
 * 商品を見出しごとにまとめる。1つもまとまらなければ null。
 * @param items カテゴリの商品（メニューの順番）
 * @param names 商品の日本語名・英語名を返す
 */
export function groupMenuItems<T>(
  items: readonly T[],
  names: (item: T) => MenuGroupNames,
  options: GroupMenuOptions<T> = {}
): MenuGroupSection<T>[] | null {
  if (items.length < 2) return null;
  const prepared = items.map((item, i) => prepare(names(item), i));
  const canGroup = (p: Prepared) => p.ja.length > 0 && (options.groupable ? options.groupable(items[p.index]) : true);

  const groups: Candidate[] = [];
  const grouped = new Set<number>();

  // 1) 空白で区切られた名前：最初の言葉が見出し
  const bySpace = new Map<string, { p: Prepared; label: string }[]>();
  for (const p of prepared) {
    if (!canGroup(p)) continue;
    const parts = p.ja.split(SPACES).filter(Boolean);
    if (parts.length < 2) continue;
    const head = parts[0];
    const list = bySpace.get(head) ?? [];
    list.push({ p, label: parts.slice(1).join(' ') });
    bySpace.set(head, list);
  }
  for (const [head, members] of bySpace) {
    if (members.length < 2) continue;
    groups.push({ key: `s:${head}`, label: head, members });
    for (const m of members) grouped.add(m.p.index);
  }

  // 2) 空白の無い名前（と、1つだけだった空白の名前）：英語の最初の単語＋日本語の頭
  const byWord = new Map<string, Prepared[]>();
  for (const p of prepared) {
    if (grouped.has(p.index) || !canGroup(p) || p.enWords.length < 2 || p.ja.length < 3) continue;
    const k = `${p.enWords[0].toLowerCase()}|${p.ja.slice(0, 2)}`;
    const list = byWord.get(k) ?? [];
    list.push(p);
    byWord.set(k, list);
  }
  for (const list of byWord.values()) {
    if (list.length < 2) continue;
    const head = commonPrefix(list.map((p) => p.ja)).replace(TRAIL_JUNK, '');
    if (head.length < 2) continue;
    const members = list.map((p) => ({ p, label: p.ja.slice(head.length).replace(LEAD_JUNK, '') }));
    if (members.some((m) => m.label.length === 0)) continue;
    groups.push({ key: `p:${groups.length}:${head}`, label: head, members });
    for (const m of members) grouped.add(m.p.index);
  }

  if (groups.length === 0) return null;

  const groupOf = new Map<number, Candidate>();
  for (const g of groups) {
    g.members.sort((a, b) => a.p.index - b.p.index);
    for (const m of g.members) groupOf.set(m.p.index, g);
  }

  const sections: MenuGroupSection<T>[] = [];
  const emitted = new Set<string>();
  for (const p of prepared) {
    const g = groupOf.get(p.index);
    if (g) {
      if (emitted.has(g.key)) continue;
      emitted.add(g.key);
      const lead = commonLeadingWords(g.members.map((m) => m.p));
      sections.push({
        kind: 'group',
        key: g.key,
        label: g.label,
        labelEn: lead.length > 0 ? lead.join(' ') : null,
        members: g.members.map((m) => ({
          item: items[m.p.index],
          label: m.label,
          labelEn: m.p.en ? (lead.length > 0 ? m.p.enWords.slice(lead.length).join(' ') : m.p.en) : null,
        })),
      });
      continue;
    }
    const last = sections[sections.length - 1];
    if (last && last.kind === 'items') last.items.push(items[p.index]);
    else sections.push({ kind: 'items', key: `i:${p.index}`, items: [items[p.index]] });
  }
  return sections;
}
