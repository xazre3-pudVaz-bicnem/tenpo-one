'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';
import { getDocumentSignedUrl } from '@/app/app/invoices/actions';
import { TriageDialog } from './triage-dialog';

export interface InboxDoc {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface Option {
  id: string;
  name: string;
}

export function InboxList({
  docs,
  stores,
  vendors,
  currentStoreId,
}: {
  docs: InboxDoc[];
  stores: Option[];
  vendors: Option[];
  currentStoreId: string | null;
}) {
  const [target, setTarget] = useState<InboxDoc | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const preview = async (doc: InboxDoc) => {
    try {
      const res = await getDocumentSignedUrl(doc.id);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch {
      toast('プレビューを開けませんでした', 'error');
    }
  };

  if (docs.length === 0) {
    return (
      <EmptyState
        title="保存ボックスは空です"
        description="ScanSnap等で取り込んだ未仕分けの書類をここへアップロードします"
      />
    );
  }

  return (
    <>
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {docs.map((doc) => (
          <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <button type="button" onClick={() => void preview(doc)} className="flex min-w-0 items-center gap-3 text-left">
              <FileText className="h-8 w-8 shrink-0 text-gray-400" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-navy">{doc.fileName}</span>
                <span className="block text-xs text-gray-500">
                  {formatDateTime(doc.createdAt)}・{(doc.sizeBytes / 1024).toFixed(0)}KB
                </span>
              </span>
            </button>
            <Button size="sm" onClick={() => setTarget(doc)}>
              仕分け
            </Button>
          </li>
        ))}
      </ul>
      <TriageDialog
        key={target?.id ?? 'closed'}
        doc={target}
        stores={stores}
        vendors={vendors}
        currentStoreId={currentStoreId}
        onClose={() => setTarget(null)}
        onDone={() => router.refresh()}
      />
    </>
  );
}
