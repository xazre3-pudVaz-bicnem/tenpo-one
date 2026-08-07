'use client';

import { useState, useTransition } from 'react';
import { Search, User, X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import type { PosCustomerSearchResult, SetOrderCustomerResult } from '@/app/app/pos/actions';

export function CustomerLinkDialog({
  open,
  onClose,
  orderId,
  currentCustomer,
  searchCustomerAction,
  setOrderCustomerAction,
  onLinked,
}: {
  open: boolean;
  onClose: () => void;
  orderId: string;
  currentCustomer: { id: string; name: string } | null;
  searchCustomerAction: (phone: string) => Promise<PosCustomerSearchResult[]>;
  setOrderCustomerAction: (orderId: string, customerId: string | null) => Promise<SetOrderCustomerResult>;
  onLinked: (result: SetOrderCustomerResult & { id: string | null }) => void;
}) {
  const { toast } = useToast();
  const [phone, setPhone] = useState('');
  const [results, setResults] = useState<PosCustomerSearchResult[] | null>(null);
  const [searchPending, startSearch] = useTransition();
  const [linkPending, startLink] = useTransition();

  const handleSearch = () => {
    if (phone.trim().length < 2) {
      toast('電話番号を2桁以上入力してください', 'error');
      return;
    }
    startSearch(async () => {
      try {
        const rows = await searchCustomerAction(phone);
        setResults(rows);
      } catch (e) {
        toast(e instanceof Error ? e.message : '検索に失敗しました', 'error');
      }
    });
  };

  const handleSelect = (customerId: string) => {
    startLink(async () => {
      try {
        const result = await setOrderCustomerAction(orderId, customerId);
        onLinked({ ...result, id: customerId });
        toast(`「${result.customerName}」を紐付けました`, 'success');
        handleClose();
      } catch (e) {
        toast(e instanceof Error ? e.message : '顧客紐付けに失敗しました', 'error');
      }
    });
  };

  const handleUnlink = () => {
    startLink(async () => {
      try {
        await setOrderCustomerAction(orderId, null);
        onLinked({ customerName: null, pointBalance: null, id: null });
        toast('顧客の紐付けを解除しました', 'success');
        handleClose();
      } catch (e) {
        toast(e instanceof Error ? e.message : '解除に失敗しました', 'error');
      }
    });
  };

  const handleClose = () => {
    setPhone('');
    setResults(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} title="顧客を紐付け">
      <div className="space-y-4">
        {currentCustomer && (
          <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary-soft/40 px-4 py-3">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-primary-deep" />
              <span className="text-sm font-semibold text-navy">{currentCustomer.name}</span>
            </div>
            <button
              type="button"
              onClick={handleUnlink}
              disabled={linkPending}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-danger hover:bg-danger-soft"
            >
              <X className="h-3.5 w-3.5" />
              解除
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            placeholder="電話番号で検索（部分一致）"
            inputMode="tel"
          />
          <Button onClick={handleSearch} disabled={searchPending}>
            <Search className="h-4 w-4" />
            検索
          </Button>
        </div>

        {results !== null && (
          results.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400">該当する顧客が見つかりません</p>
          ) : (
            <ul className="max-h-[40vh] divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={linkPending}
                    onClick={() => handleSelect(c.id)}
                    className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-navy">{c.name}</p>
                      <p className="text-xs text-gray-500">{c.phone ?? '電話番号未登録'}</p>
                    </div>
                    <span className="text-xs font-semibold tabular-nums text-primary-deep">{c.pointBalance}pt</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </Dialog>
  );
}
