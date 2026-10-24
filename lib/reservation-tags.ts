/**
 * お客様・予約のタグ（区分ごと。小さいアイコンつきのチップ。2026-10-24 Ronnie）。
 * 区分：お客様の特徴・食事の制限・客単価・利用目的・席の希望。各区分は開閉でき、多い区分は「もっと見る」。
 * 店舗の設定で追加・編集できる（store_settings.settings.reservation_tag_groups）。キーワード（10 個・15 文字）とは別。
 * 予約に付けたタグは reservations.tags にキーワードと一緒に入る（名前の文字列）。
 * ここは画面を持たない決まりだけ（Web・iPad・サーバーで同じものを使う）。
 */

/** アイコンの名前（iPad は SF Symbols に、Web は lucide に読み替える。知らない名前は tag） */
export const TAG_ICONS = [
  'tag', 'star', 'flag', 'wine', 'paw', 'clock', 'leaf', 'carrot', 'wheat', 'alert', 'drop', 'nut', 'egg', 'fish',
  'yen', 'gem', 'gift', 'heart', 'briefcase', 'party', 'sparkles', 'people', 'family', 'flower', 'chair', 'wheelchair',
  'stroller', 'smoke', 'window', 'door', 'music', 'camera',
] as const;
export type TagIcon = (typeof TAG_ICONS)[number];

export interface ReservationTagDef {
  label: string;
  icon: TagIcon;
}

export interface ReservationTagGroup {
  /** 区分の id（英字）。店舗が足した区分は custom-… */
  key: string;
  label: string;
  /** 最初に見せる数（それより多いと「もっと見る」）。0 は全部 */
  visible: number;
  tags: ReservationTagDef[];
}

export const TAG_LABEL_MAX = 15;
export const TAG_GROUP_LABEL_MAX = 15;
export const TAGS_PER_GROUP_MAX = 30;
export const TAG_GROUPS_MAX = 10;

const t = (label: string, icon: TagIcon): ReservationTagDef => ({ label, icon });

export const DEFAULT_RESERVATION_TAG_GROUPS: ReservationTagGroup[] = [
  {
    key: 'guest',
    label: 'お客様の特徴',
    visible: 0,
    tags: [t('VIP', 'star'), t('要注意', 'flag'), t('ワイン好き', 'wine'), t('ペット同伴', 'paw'), t('遅刻が多い', 'clock')],
  },
  {
    key: 'dietary',
    label: '食事の制限',
    visible: 6,
    tags: [
      t('ヴィーガン', 'leaf'),
      t('ベジタリアン', 'carrot'),
      t('グルテン不耐', 'wheat'),
      t('セリアック', 'alert'),
      t('乳糖不耐', 'drop'),
      t('ナッツアレルギー', 'nut'),
      t('卵アレルギー', 'egg'),
      t('乳アレルギー', 'drop'),
      t('小麦アレルギー', 'wheat'),
      t('甲殻類アレルギー', 'fish'),
      t('そばアレルギー', 'alert'),
      t('落花生アレルギー', 'nut'),
      t('ハラール', 'alert'),
      t('お酒を飲まない', 'wine'),
    ],
  },
  { key: 'value', label: '客単価', visible: 0, tags: [t('低め', 'yen'), t('高め', 'gem')] },
  {
    key: 'occasion',
    label: '利用目的',
    visible: 6,
    tags: [
      t('誕生日', 'gift'),
      t('記念日', 'heart'),
      t('デート', 'wine'),
      t('接待／会食', 'briefcase'),
      t('お祝い', 'party'),
      t('特別な日', 'sparkles'),
      t('歓送迎会', 'party'),
      t('女子会', 'people'),
      t('家族の集まり', 'family'),
      t('同窓会', 'people'),
      t('顔合わせ', 'people'),
      t('法事', 'flower'),
    ],
  },
  {
    key: 'seating',
    label: '席の希望',
    visible: 0,
    tags: [t('子供用いす', 'chair'), t('車いす対応', 'wheelchair'), t('ベビーカー', 'stroller'), t('ペット可の席', 'paw')],
  },
];

function charCount(s: string): number {
  return Array.from(s).length;
}

function iconOf(v: unknown): TagIcon {
  return typeof v === 'string' && (TAG_ICONS as readonly string[]).includes(v) ? (v as TagIcon) : 'tag';
}

/**
 * 保存できる形に確かめる（サーバーでも必ず通す）。前後の空白は削る。空白だけ・同じ区分の中の重複は落とす。
 * 長すぎる名前・多すぎる数はエラー。
 */
export function sanitizeTagGroups(raw: unknown): { ok: true; groups: ReservationTagGroup[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'タグの形が正しくありません' };
  if (raw.length > TAG_GROUPS_MAX) return { ok: false, error: `区分は ${TAG_GROUPS_MAX} 個までです` };
  const groups: ReservationTagGroup[] = [];
  const keys = new Set<string>();
  for (const g of raw) {
    if (!g || typeof g !== 'object') return { ok: false, error: 'タグの形が正しくありません' };
    const o = g as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (!label) return { ok: false, error: '区分の名前を入れてください' };
    if (charCount(label) > TAG_GROUP_LABEL_MAX) return { ok: false, error: `区分の名前は ${TAG_GROUP_LABEL_MAX} 文字までです` };
    let key = typeof o.key === 'string' && /^[a-z0-9-]{1,40}$/.test(o.key) ? o.key : '';
    if (!key || keys.has(key)) key = `custom-${groups.length + 1}-${Math.abs(hash(label)).toString(36)}`;
    keys.add(key);
    if (!Array.isArray(o.tags)) return { ok: false, error: 'タグの形が正しくありません' };
    const tags: ReservationTagDef[] = [];
    for (const tg of o.tags) {
      const to = (tg ?? {}) as Record<string, unknown>;
      const tl = typeof to.label === 'string' ? to.label.trim() : typeof tg === 'string' ? tg.trim() : '';
      if (!tl) continue;
      if (charCount(tl) > TAG_LABEL_MAX) return { ok: false, error: `タグは ${TAG_LABEL_MAX} 文字までです（${label}）` };
      if (tags.some((x) => x.label === tl)) continue;
      tags.push({ label: tl, icon: iconOf(to.icon) });
    }
    if (tags.length > TAGS_PER_GROUP_MAX) return { ok: false, error: `1 つの区分のタグは ${TAGS_PER_GROUP_MAX} 個までです（${label}）` };
    const visible = typeof o.visible === 'number' && Number.isInteger(o.visible) && o.visible >= 0 && o.visible <= TAGS_PER_GROUP_MAX ? o.visible : 0;
    groups.push({ key, label, visible, tags });
  }
  return { ok: true, groups };
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + (c.codePointAt(0) ?? 0)) | 0;
  return h;
}

/** 店舗のタグの区分（設定が無い・壊れているときは既定） */
export function reservationTagGroupsFrom(settings: unknown): ReservationTagGroup[] {
  const raw = (settings as { reservation_tag_groups?: unknown } | null)?.reservation_tag_groups;
  if (raw === undefined || raw === null) return DEFAULT_RESERVATION_TAG_GROUPS.map((g) => ({ ...g, tags: [...g.tags] }));
  const r = sanitizeTagGroups(raw);
  return r.ok ? r.groups : DEFAULT_RESERVATION_TAG_GROUPS.map((g) => ({ ...g, tags: [...g.tags] }));
}

/** タグの名前 → アイコン（予約カード・詳細の小さい表示用。キーワードなど区分に無い名前は null） */
export function tagIconMap(groups: ReservationTagGroup[]): Record<string, TagIcon> {
  const out: Record<string, TagIcon> = {};
  for (const g of groups) for (const tg of g.tags) if (!(tg.label in out)) out[tg.label] = tg.icon;
  return out;
}
