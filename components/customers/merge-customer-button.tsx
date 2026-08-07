'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { GitMerge, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { mergeCustomers, searchCustomersForMerge, type MergeCandidateResult } from '@/app/app/customers/actions';

/** 顧客詳細の「この顧客と統合」導線: 電話番号で検索 → 対象選択 → merge_customers RPC */
export function MergeCustomerButton({ customerId, customerName }: { customerId: string; customerName: string }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [results, setResults] = useState<MergeCandidateResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const handleSearch = async () => {
    if (!phone.trim()) return;
    setSearching(true);
    try {
      const rows = await searchCustomersForMerge(phone, customerId);
      setResults(rows);
      setSelected(null);
      setHasSearched(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : '検索に失敗しました', 'error');
    } finally {
      setSearching(false);
    }
  };

  const handleMerge = () => {
    if (!selected) return;
    startTransition(async () => {
      try {
        await mergeCustomers(customerId, [selected]);
        toast('顧客を統合しました');
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : '統合に失敗しました', 'error');
      }
    });
  };

  const close = () => {
    setOpen(false);
    setPhone('');
    setResults([]);
    setSelected(null);
    setHasSearched(false);
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <GitMerge className="h-3.5 w-3.5" />
        この顧客と統合
      </Button>
      <Dialog open={open} onClose={close} title="重複顧客と統合">
        <p className="text-sm text-gray-700">
          電話番号で検索し、「{customerName}」に統合する顧客を選択してください。統合先の予約・注文・ポイント履歴は「{customerName}
          」に引き継がれ、選択した顧客は削除扱いになります。
        </p>
        <div className="mt-4 flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="merge-phone-search">電話番号</Label>
            <Input
              id="merge-phone-search"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch();
              }}
              placeholder="090-1234-5678"
            />
          </div>
          <Button type="button" variant="secondary" onClick={handleSearch} disabled={searching || !phone.trim()}>
            <Search className="h-4 w-4" />
            検索
          </Button>
        </div>

        {hasSearched && results.length === 0 && (
          <p className="mt-3 text-xs text-gray-400">該当する顧客が見つかりませんでした</p>
        )}

        {results.length > 0 && (
          <div className="mt-4 space-y-2">
            {results.map((r) => (
              <label
                key={r.id}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40"
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="merge-target"
                    checked={selected === r.id}
                    onChange={() => setSelected(r.id)}
                    className="h-4 w-4 text-primary focus:ring-primary"
                  />
                  <span>
                    <span className="block text-sm font-medium text-navy">{r.name}</span>
                    <span className="block text-xs text-gray-500">
                      {r.phone || '—'}｜{r.email || '—'}｜来店{r.visitCount}回｜{yen(r.totalSpent)}
                    </span>
                  </span>
                </span>
                <Badge tone="gray">統合される</Badge>
              </label>
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={pending}>
            キャンセル
          </Button>
          <Button variant="danger" onClick={handleMerge} disabled={pending || !selected}>
            {pending ? '統合中…' : '統合する'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
