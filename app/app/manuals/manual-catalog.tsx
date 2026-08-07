'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Link as LinkIcon, Trash2, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { getManualSignedUrl, deleteManual } from './actions';
import { MANUAL_CATEGORIES, MANUAL_CATEGORY_LABELS, type ManualCategory } from './labels';

export interface ManualItem {
  id: string;
  title: string;
  category: ManualCategory;
  storeLabel: string;
  hasFile: boolean;
  url: string | null;
  note: string | null;
  canDelete: boolean;
}

export function ManualCatalog({ manuals }: { manuals: ManualItem[] }) {
  const [tab, setTab] = useState<ManualCategory | 'all'>('all');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const filtered = tab === 'all' ? manuals : manuals.filter((m) => m.category === tab);

  const openFile = async (id: string) => {
    setOpening(id);
    try {
      const url = await getManualSignedUrl(id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast(e instanceof Error ? e.message : '開けませんでした', 'error');
    } finally {
      setOpening(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setTab('all')}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === 'all' ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          すべて（{manuals.length}）
        </button>
        {MANUAL_CATEGORIES.map((c) => {
          const count = manuals.filter((m) => m.category === c).length;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setTab(c)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === c ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {MANUAL_CATEGORY_LABELS[c]}（{count}）
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="該当するマニュアルはありません" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((m) => (
            <Card key={m.id} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {m.hasFile ? <FileText className="h-4 w-4 shrink-0 text-primary" /> : <LinkIcon className="h-4 w-4 shrink-0 text-primary" />}
                  <p className="truncate font-medium text-navy">{m.title}</p>
                </div>
                <Badge tone="gray">{MANUAL_CATEGORY_LABELS[m.category]}</Badge>
              </div>
              <p className="mt-1 text-xs text-gray-500">{m.storeLabel}</p>
              {m.note && <p className="mt-2 line-clamp-2 text-xs text-gray-600">{m.note}</p>}
              <div className="mt-3 flex items-center justify-between gap-2">
                {m.hasFile ? (
                  <Button size="sm" variant="secondary" onClick={() => void openFile(m.id)} disabled={opening === m.id}>
                    {opening === m.id ? '開いています…' : '開く'}
                  </Button>
                ) : (
                  <a href={m.url ?? '#'} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    開く
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                {m.canDelete && (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmId(m.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-danger" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmId}
        onClose={() => setConfirmId(null)}
        title="マニュアルを削除"
        message="このマニュアルを削除します。よろしいですか？"
        requireReason={false}
        onConfirm={async () => {
          if (!confirmId) return;
          try {
            await deleteManual(confirmId);
            toast('マニュアルを削除しました');
            router.refresh();
          } catch (e) {
            toast(e instanceof Error ? e.message : '削除に失敗しました', 'error');
          }
        }}
      />
    </div>
  );
}
