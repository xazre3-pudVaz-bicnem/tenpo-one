import { exitStoreAdmin } from '@/app/admin/support/enter-actions';

/** 運営がコントロールセンターからお店の管理画面に入っているときの帯（画面の下に浮かせる：上のバー・左メニューの位置を変えない。lib/support-access.ts） */
export function SupportBanner({ organizationName, storeName }: { organizationName: string | null; storeName: string | null }) {
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-full bg-[#ffc634] px-5 py-2 text-[13px] font-bold text-[#171333] shadow-lg">
      <span>
        運営として {organizationName ?? ''}
        {storeName ? ` ${storeName}` : '（全店舗）'} の管理画面を表示中（操作は監査ログに残ります）
      </span>
      <form action={exitStoreAdmin}>
        <button type="submit" className="rounded-md bg-[#171333] px-3 py-1 text-[12.5px] text-white hover:opacity-90">
          コントロールセンターに戻る
        </button>
      </form>
    </div>
  );
}
