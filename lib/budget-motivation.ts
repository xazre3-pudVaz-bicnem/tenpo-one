/**
 * ホームの予算達成率カードに出す応援メッセージ（目標に届いていないときだけ）。
 * 2026-09-30 Ronnie「目標に届いていなければ、自動でやる気の出る言葉を。『もうちょい頑張ろう』
 * 『あと何組お迎えすれば達成』のように、ちょっと面白く」。
 *
 * 達成率と時間帯で言葉を選び、同じ時間のあいだは同じ文（再読込でコロコロ変わらない）。
 * 1組あたりの売上（本日の会計済み。まだ無ければ昨日）から「あと何組で達成」を出す。
 * ここは純粋な関数だけ（DB・React 非依存・テスト対象）。
 */

export interface BudgetMotivationInput {
  /** 実績（会計済み＋未会計） */
  actual: number;
  /** 本日の予算 */
  budget: number;
  /** 1組あたりの売上（分からなければ null） */
  perGroup: number | null;
  /** いまの時（JST 0〜23） */
  hour: number;
  /** 文を選ぶ種（日付など。同じ種なら同じ文） */
  seed: string;
}

export interface BudgetMotivation {
  /** 大きく出す一言 */
  headline: string;
  /** あと¥X・あと◯組 */
  remaining: number;
  groupsNeeded: number | null;
  /** ひと声のヒント */
  tip: string;
}

/** 達成率ごとの一言（同じ段のなかから種で1つ選ぶ） */
const HEADLINES: { min: number; late?: boolean; lines: string[] }[] = [
  { min: 90, lines: ['ゴールは目の前！もうひと押し 🔥', 'あと少し！ラストスパートいきましょう 🏃', 'ここまで来たら決めましょう！'] },
  { min: 70, lines: ['いい流れ！この調子でいこう 👍', 'ナイスペース！もう一段ギアを上げよう', '順調です！笑顔でもうひと盛り上がり'] },
  { min: 50, lines: ['折り返し地点！後半も楽しくいきましょう', '半分クリア！ここから巻き返しタイム 💪', 'いい感じ！あとひと山こえよう'] },
  {
    min: 0,
    late: true,
    lines: ['もうちょい頑張ろう！最後まで諦めない 💪', 'まだ間に合う！ひと声で流れは変わります', 'ラストの1組まで全力で！'],
  },
  { min: 0, lines: ['まだまだこれから！今日もいきましょう ☀️', '1組ずつ丁寧に。ここから伸ばそう！', '今日もいい1日にしましょう 😄'] },
];

/** 売上を伸ばすひと声（種で1つ選ぶ） */
const TIPS = [
  'ドリンクのおかわり、ひと声かけてみよう',
  'おすすめの一品をテーブルでひと押し',
  'デザート・食後のコーヒーをご案内してみよう',
  'グラスが空いていたらチャンス！',
  '本日のおすすめを笑顔でご紹介',
  'お帰りのお客様に次回のご予約をひと声',
];

/** 夜遅い（20時〜翌4時）か */
function isLate(hour: number): boolean {
  return hour >= 20 || hour < 4;
}

/** 文字列から 0 以上の整数（同じ文字列なら同じ数） */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * 目標に届いていなければ応援メッセージ。届いている・予算が無いときは null（何も出さない）。
 */
export function budgetMotivation(input: BudgetMotivationInput): BudgetMotivation | null {
  const { actual, budget, perGroup, hour, seed } = input;
  if (!(budget > 0)) return null;
  const remaining = Math.ceil(budget - Math.max(0, actual));
  if (remaining <= 0) return null;

  const pct = (Math.max(0, actual) / budget) * 100;
  const late = isLate(hour);
  const tier = HEADLINES.find((t) => pct >= t.min && (t.late ? late : true)) ?? HEADLINES[HEADLINES.length - 1];
  const h = hash(`${seed}|${hour}`);
  const headline = tier.lines[h % tier.lines.length];
  const tip = TIPS[(h >>> 3) % TIPS.length];
  const groupsNeeded = perGroup != null && perGroup > 0 ? Math.max(1, Math.ceil(remaining / perGroup)) : null;
  return { headline, remaining, groupsNeeded, tip };
}
