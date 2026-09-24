'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { yen } from '@/lib/format';

export interface MenuStockRow {
  id: string;
  name: string;
  categoryName: string | null;
  price: number;
  /** 設定した本日の食数（未設定は null＝在庫管理しない） */
  limit: number | null;
  /** 本日すでに売れた数 */
  sold: number;
  /** 手動の品切れ */
  manualSoldOut: boolean;
}

/**
 * メニューの売り切り（本日の食数）。2026-09-24 店舗要望。
 * 仕込んだ数を入れておくと、その数だけ売れた時点でレジ・ハンディ・お客様QRで自動的に売り切れになる。
 */
export function MenuStockPanel({
  storeId,
  rows,
  saveAction,
}: {
  storeId: string;
  rows: MenuStockRow[];
  saveAction: (storeId: string, itemId: string, limit: number | null) => Promise<{ error?: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const visible = q
    ? rows.filter((r) => `${r.name} ${r.categoryName ?? ''}`.toLowerCase().includes(q))
    : rows;

  const save = (row: MenuStockRow, raw: string) => {
    const text = raw.trim();
    const limit = text === '' ? null : Number(text);
    if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
      toast('食数は0以上の整数で入力してください', 'error');
      return;
    }
    setBusy(row.id);
    startTransition(async () => {
      const res = await saveAction(storeId, row.id, limit);
      setBusy(null);
      if (res.error) {
        toast(res.error, 'error');
        return;
      }
      setDrafts((d) => {
        const next = { ...d };
        delete next[row.id];
        return next;
      });
      toast(limit === null ? `${row.name} の在庫管理をやめました` : `${row.name} を本日${limit}食にしました`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">
        仕込んだ数（本日の食数）を入れると、その数だけ売れた時点でレジ・ハンディ・お客様QRで自動的に
        「売切」になります。空欄にすると在庫管理をやめます（数えません）。数は毎日の営業日で数え直します。
      </p>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="商品名・カテゴリで検索 / Search"
        className="max-w-sm"
      />

      {visible.length === 0 ? (
        <EmptyState title="商品がありません" description="メニューを登録すると、ここで本日の食数を決められます。" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>商品</Th>
                <Th className="text-right">価格</Th>
                <Th className="text-right">本日の食数</Th>
                <Th className="text-right">売れた数</Th>
                <Th className="text-right">残り</Th>
                <Th>状態</Th>
              </Tr>
            </THead>
            <TBody>
              {visible.map((r) => {
                const draft = drafts[r.id];
                const text = draft ?? (r.limit === null ? '' : String(r.limit));
                const remaining = r.limit === null ? null : Math.max(0, r.limit - r.sold);
                const soldOut = r.manualSoldOut || (remaining !== null && remaining <= 0);
                return (
                  <Tr key={r.id}>
                    <Td>
                      <span className="font-bold text-navy">{r.name}</span>
                      {r.categoryName && <small className="block text-ink-3">{r.categoryName}</small>}
                    </Td>
                    <Td className="text-right tabular-nums">{yen(r.price)}</Td>
                    <Td className="text-right">
                      <span className="flex items-center justify-end gap-1.5">
                        <Input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={text}
                          onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') save(r, (e.target as HTMLInputElement).value);
                          }}
                          placeholder="—"
                          className="w-[88px] text-right"
                          aria-label={`${r.name}の本日の食数`}
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending || draft === undefined}
                          onClick={() => save(r, text)}
                        >
                          {busy === r.id ? '保存中…' : '保存'}
                        </Button>
                      </span>
                    </Td>
                    <Td className="text-right tabular-nums">{r.sold}</Td>
                    <Td className="text-right tabular-nums font-bold">
                      {remaining === null ? '—' : remaining}
                    </Td>
                    <Td>
                      {soldOut ? (
                        <Badge tone="danger">売切</Badge>
                      ) : r.limit === null ? (
                        <span className="text-ink-3">—</span>
                      ) : (
                        <Badge tone="primary">販売中</Badge>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
