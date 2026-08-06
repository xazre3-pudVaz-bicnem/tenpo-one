import { AlertTriangle } from 'lucide-react';

/** 給与画面共通の法定計算免責表示 */
export function PayrollDisclaimer({ className }: { className?: string }) {
  return (
    <div className={`flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-xs text-warning ${className ?? ''}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        本機能は概算の試算です。税金・社会保険料・年末調整は含まれません。正式な給与計算は社会保険労務士・税理士へご確認ください。
      </p>
    </div>
  );
}
