/**
 * 画面見出し。en を渡すと英語ラベルを併記する（例: テーブル一覧 Tables）。
 * 見出しの文字は 紫のグラデーション（2026-09-27 Ronnie「紫と黒だけ」）。
 */
export function PageHeader({
  title,
  en,
  description,
  actions,
}: {
  title: React.ReactNode;
  en?: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-navy">
          <span className="text-brand">{title}</span>
          {en && <span className="en-inline text-xs">{en}</span>}
        </h1>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
