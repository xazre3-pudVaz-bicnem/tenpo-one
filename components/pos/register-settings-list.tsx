import Link from 'next/link';
import { ChevronRight, Lock } from 'lucide-react';
import { permissionHint, type RegisterSettingSectionView } from '@/lib/register-settings';

/**
 * レジの設定の一覧（メニュー・キッチン・テーブル・ハンディ・予約）。
 * 押すとその設定の画面が開き、画面の上の「レジの設定に戻る」でここに戻れる。
 * 権限が無い項目は押せない形で「店長以上が変更できます」を出す。
 */
export function RegisterSettingsList({ sections }: { sections: RegisterSettingSectionView[] }) {
  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <section key={section.id} aria-labelledby={`register-settings-${section.id}`}>
          <h2 id={`register-settings-${section.id}`} className="mb-2 text-sm font-bold text-navy">
            {section.title}
            <span className="ml-1.5 text-xs font-normal text-gray-400">{section.en}</span>
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {section.links.map((link) => (
              <li key={link.id}>
                {link.allowed ? (
                  <Link
                    href={link.url}
                    className="flex min-h-[72px] items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary-soft/30"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold text-navy">{link.title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{link.description}</span>
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" aria-hidden />
                  </Link>
                ) : (
                  <div
                    aria-disabled="true"
                    className="flex min-h-[72px] items-center gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold text-gray-400">{link.title}</span>
                      <span className="mt-0.5 block text-xs text-gray-400">{permissionHint(link.permission)}</span>
                    </span>
                    <Lock className="h-4 w-4 shrink-0 text-gray-300" aria-hidden />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
