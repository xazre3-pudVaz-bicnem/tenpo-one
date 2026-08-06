import { CalendarCheck, Footprints, UtensilsCrossed, CreditCard, TrendingUp, Users, JapaneseYen, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const STEPS: { label: string; desc: string; icon: LucideIcon }[] = [
  { label: '予約', desc: 'オンライン予約・台帳', icon: CalendarCheck },
  { label: '来店', desc: 'テーブル案内・着席', icon: Footprints },
  { label: '注文', desc: 'POSで注文入力', icon: UtensilsCrossed },
  { label: '会計', desc: '税率自動判定・決済', icon: CreditCard },
  { label: '売上', desc: 'レジ締め・日報自動化', icon: TrendingUp },
  { label: '顧客', desc: '来店履歴・累計利用額', icon: Users },
  { label: '給与', desc: '勤怠から歩合試算へ', icon: JapaneseYen },
];

/** 予約→来店→注文→会計→売上→顧客→給与が単一データでつながることを示すフロー図（CSSのみ）。 */
export function DataFlow() {
  return (
    <div className="overflow-x-auto pb-2">
      <ol className="flex min-w-max items-stretch gap-2 px-1 sm:gap-3">
        {STEPS.map((step, i) => (
          <li key={step.label} className="flex items-stretch">
            <div className="flex w-32 flex-col items-center rounded-2xl border border-gray-200 bg-white px-3 py-4 text-center shadow-sm sm:w-36">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-primary-deep">
                <step.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="mt-3 text-sm font-bold text-navy">{step.label}</span>
              <span className="mt-1 text-[11px] leading-snug text-gray-500">{step.desc}</span>
            </div>
            {i < STEPS.length - 1 && (
              <span className="flex items-center px-1 text-gray-300 sm:px-2" aria-hidden="true">
                <ArrowRight className="h-5 w-5" />
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
