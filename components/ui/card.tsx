import { cn } from '@/lib/utils';

// 角丸・影・見出しの太さはテーマ変数（app/globals.css の --ui-*）で店舗画面/その他を切り替える
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('ui-card border border-gray-200 bg-white', className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('ui-card-header border-b border-gray-100 px-5', className)} {...props} />;
}

/** カード見出し。en を渡すと英語ラベルを併記する（例: 予算達成率 Budget）。 */
export function CardTitle({
  className,
  en,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { en?: string }) {
  return (
    <h3 className={cn('ui-card-title text-navy', className)} {...props}>
      {children}
      {en && <span className="en-inline">{en}</span>}
    </h3>
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}
