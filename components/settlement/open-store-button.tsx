'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { switchStore } from '@/app/app/actions';

/** 全店一覧の行から、その店の月次清算（日ごとの表）を開く（上部バーの店舗切替と同じ仕組み） */
export function OpenStoreButton({ storeId, label }: { storeId: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await switchStore(storeId);
          router.refresh();
        })
      }
      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-navy hover:bg-gray-50 disabled:opacity-50"
    >
      {label}
      <ChevronRight className="h-3.5 w-3.5" />
    </button>
  );
}
