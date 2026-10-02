'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { MenuPagesEditor } from '@/components/settings/menu-book-editor';
import { loadMenuPagesEditor, type MenuPagesEditorData } from '@/app/app/settings/menu-book/actions';

/**
 * レジの注文画面から開く「タブの編集」（上のタブ＝ページの順番・名前・中身）。
 * 2026-10-02 FULL MOoN 御茶ノ水「赤い四角（上のタブ）を店で edit できるように」
 * 「ランチが多い店、コースや飲み放題が多い店、単品が多い店があるので、順番が変えられるといい」。
 * 中身は 設定 → メニューブック → ページ と同じ（保存するとレジ・ハンディ・お客様QRに反映）。
 * 伝票の画面から離れないので、打ちかけのカートはそのまま。店長以上（menu.manage）だけボタンが出る。
 */
export function MenuPagesDialog({ storeId, open, onClose }: { storeId: string; open: boolean; onClose: () => void }) {
  const [data, setData] = useState<MenuPagesEditorData | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadMenuPagesEditor(storeId)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setData({ categories: [], pages: [], categoryPage: {}, error: '読み込みに失敗しました。もう一度開いてください' });
      });
    return () => {
      alive = false;
      setData(null);
    };
  }, [open, storeId]);

  return (
    <Dialog open={open} onClose={onClose} title="タブの編集 / Edit tabs" wide>
      {!data ? (
        <p className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          読み込み中…
        </p>
      ) : data.error ? (
        <p className="py-8 text-center text-sm text-danger">{data.error}</p>
      ) : (
        <MenuPagesEditor
          storeId={storeId}
          categories={data.categories}
          pages={data.pages}
          categoryPage={data.categoryPage}
          onSaved={onClose}
        />
      )}
    </Dialog>
  );
}
