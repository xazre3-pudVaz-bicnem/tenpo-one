'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { checkDuplicateDocument } from '@/app/app/invoices/actions';
import { createScanDocument, attachReceiptToCashTransaction } from '@/app/app/scan/actions';
import { extFromFile, validateAttachedFile } from '@/components/invoices/labels';

type Status = 'uploading' | 'needs-confirm' | 'success' | 'failed' | 'skipped';

interface Task {
  id: string;
  file: File;
  status: Status;
  message?: string;
}

/**
 * 撮影・取り込み（プロトタイプの scan-drop）。
 * 書類取込（components/invoices/upload-zone）と同じ手順: Storageへ直接アップロード → メタ登録（領収書）。
 * txId があるときはアップロード後にその出金へレシートを紐付ける。OCRは行わない。
 */
export function ScanCapture({
  organizationId,
  storeId,
  txId,
  compact,
}: {
  organizationId: string;
  storeId: string | null;
  txId?: string | null;
  compact?: boolean;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const router = useRouter();

  const patch = useCallback((id: string, p: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));
  }, []);

  const upload = useCallback(
    async (task: Task) => {
      patch(task.id, { status: 'uploading', message: undefined });
      const supabase = createClient();
      const now = new Date();
      const yyyy = String(now.getFullYear());
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const path = `${organizationId}/${storeId ?? 'hq'}/${yyyy}/${mm}/${crypto.randomUUID()}.${extFromFile(task.file)}`;
      const { error: uploadError } = await supabase.storage.from('documents').upload(path, task.file, {
        contentType: task.file.type,
        upsert: false,
      });
      if (uploadError) {
        patch(task.id, { status: 'failed', message: 'ストレージへのアップロードに失敗しました' });
        return;
      }
      try {
        const { id } = await createScanDocument({
          filePath: path,
          fileName: task.file.name,
          mimeType: task.file.type,
          sizeBytes: task.file.size,
          storeId,
        });
        if (txId) {
          try {
            await attachReceiptToCashTransaction(txId, id);
            patch(task.id, { status: 'success', message: '保存して出金に紐付けました' });
          } catch (e) {
            patch(task.id, {
              status: 'failed',
              message: `書類は保存しましたが、出金への紐付けに失敗しました：${e instanceof Error ? e.message : '不明なエラー'}`,
            });
          }
        } else {
          patch(task.id, { status: 'success', message: '保存ボックスに保存しました' });
        }
        router.refresh();
      } catch (e) {
        patch(task.id, { status: 'failed', message: e instanceof Error ? e.message : '登録に失敗しました' });
      }
    },
    [organizationId, storeId, txId, router, patch]
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files).slice(0, txId ? 1 : 20);
      const created: Task[] = list.map((file) => {
        const err = validateAttachedFile(file);
        return err
          ? { id: crypto.randomUUID(), file, status: 'failed', message: `${err}（iPhoneの場合は「互換性優先（JPEG）」で撮影してください）` }
          : { id: crypto.randomUUID(), file, status: 'uploading' };
      });
      setTasks((prev) => [...created, ...prev].slice(0, 20));
      for (const t of created) {
        if (t.status !== 'uploading') continue;
        void (async () => {
          try {
            const { duplicate } = await checkDuplicateDocument(t.file.name, t.file.size);
            if (duplicate) {
              patch(t.id, { status: 'needs-confirm', message: '同じファイル名・サイズの書類がすでにあります' });
              return;
            }
          } catch {
            // 重複チェックの失敗ではブロックしない
          }
          await upload(t);
        })();
      }
    },
    [txId, upload, patch]
  );

  const busy = tasks.some((t) => t.status === 'uploading');

  return (
    <div className="space-y-3">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[14px] border-2 border-dashed border-iris text-center text-royal transition-colors hover:bg-lilac',
          compact ? 'px-4 py-6' : 'px-4 py-10',
          dragging ? 'bg-lilac' : 'bg-iris-soft'
        )}
      >
        {/* capture は意図的に付けていない。付けるとスマホ・iPadで必ずカメラが開き、
            あとから写真フォルダやファイルのPDFを選べなくなる（＝その場で撮るしかない）。
            外すとOS標準の「撮影 / フォトライブラリ / ファイルを選択」が出る。 */}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/*,application/pdf"
          multiple={!txId}
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
        {busy ? <Loader2 className="h-10 w-10 animate-spin" /> : <Camera className="h-10 w-10" strokeWidth={1.8} />}
        <b className="mt-1 text-[17px]">{txId ? 'この出金のレシートを撮影する' : '撮影する'}</b>
        <span className="text-[15px] font-bold">カメラで撮影 ／ 写真・PDFを選ぶ</span>
        <span className="text-xs text-ink-3">
          {txId ? '撮ったらそのまま保存して、この出金に紐付けます' : 'レシート・請求書を撮ると保存ボックスに領収書として保存します'}
        </span>
      </label>

      {tasks.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white" aria-live="polite">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3.5 py-2.5">
              {t.status === 'uploading' && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-iris" />}
              {t.status === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />}
              {(t.status === 'failed' || t.status === 'needs-confirm') && (
                <AlertTriangle className={cn('h-4 w-4 shrink-0', t.status === 'failed' ? 'text-danger' : 'text-saffron')} />
              )}
              {t.status === 'skipped' && <span className="h-4 w-4 shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-ink">{t.file.name}</p>
                <p
                  className={cn(
                    'text-xs',
                    t.status === 'success' ? 'text-success' : t.status === 'failed' ? 'text-danger' : 'text-ink-3'
                  )}
                >
                  {t.status === 'uploading' ? 'アップロード中…' : t.status === 'skipped' ? 'スキップしました' : t.message}
                </p>
              </div>
              {t.status === 'needs-confirm' && (
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => patch(t.id, { status: 'skipped' })}>
                    スキップ
                  </Button>
                  <Button size="sm" onClick={() => void upload(t)}>
                    続行
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
