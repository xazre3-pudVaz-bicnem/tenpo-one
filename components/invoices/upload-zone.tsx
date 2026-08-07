'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud, Loader2, CheckCircle2, XCircle, AlertTriangle, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createInboxDocument, checkDuplicateDocument } from '@/app/app/invoices/actions';
import { ACCEPTED_FILE_ACCEPT, extFromFile, validateAttachedFile } from './labels';

type TaskStatus = 'checking' | 'needs-confirm' | 'uploading' | 'success' | 'failed' | 'skipped';

interface UploadTask {
  id: string;
  file: File;
  status: TaskStatus;
  error?: string;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  checking: '確認中…',
  'needs-confirm': '重複の可能性',
  uploading: 'アップロード中…',
  success: '成功',
  failed: '失敗',
  skipped: 'スキップ済み',
};

/**
 * 保存ボックス用のドラッグ&ドロップアップローダー（ScanSnap Inbox）。
 * - クライアントから直接Supabase Storageへアップロードし、成功したらメタデータをserver actionでdocumentsへ登録する。
 * - ファイルごとの進捗（待機/アップロード中/成功/失敗）を個別表示する。
 * - 同一org・同一ファイル名+サイズの既存書類があれば重複の可能性を警告し、スキップ/続行を選ばせる。
 * - メタ登録action（createInboxDocument）側でもMIME・拡張子・サイズ・危険拡張子・レート制限を再検証する。
 */
export function UploadZone({ organizationId, storeId }: { organizationId: string; storeId: string | null }) {
  const [dragging, setDragging] = useState(false);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const updateTask = useCallback((id: string, patch: Partial<UploadTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const uploadTask = useCallback(
    async (id: string, file: File) => {
      updateTask(id, { status: 'uploading' });
      const supabase = createClient();
      const now = new Date();
      const yyyy = String(now.getFullYear());
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const ext = extFromFile(file);
      const path = `${organizationId}/${storeId ?? 'hq'}/${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage.from('documents').upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) {
        updateTask(id, { status: 'failed', error: 'ストレージへのアップロードに失敗しました' });
        return;
      }

      try {
        await createInboxDocument({ filePath: path, fileName: file.name, mimeType: file.type, sizeBytes: file.size });
        updateTask(id, { status: 'success' });
        router.refresh();
      } catch (e) {
        updateTask(id, { status: 'failed', error: e instanceof Error ? e.message : '登録に失敗しました' });
      }
    },
    [organizationId, storeId, router, updateTask]
  );

  const processTask = useCallback(
    async (task: UploadTask) => {
      try {
        const { duplicate } = await checkDuplicateDocument(task.file.name, task.file.size);
        if (duplicate) {
          updateTask(task.id, { status: 'needs-confirm' });
          return;
        }
      } catch {
        // 重複チェックに失敗してもアップロード自体はブロックしない
      }
      await uploadTask(task.id, task.file);
    },
    [uploadTask, updateTask]
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      const newTasks: UploadTask[] = list.map((file) => {
        const validationError = validateAttachedFile(file);
        return validationError
          ? { id: crypto.randomUUID(), file, status: 'failed' as const, error: validationError }
          : { id: crypto.randomUUID(), file, status: 'checking' as const };
      });

      setTasks((prev) => [...prev, ...newTasks]);
      for (const t of newTasks) {
        if (t.status === 'checking') void processTask(t);
      }
    },
    [processTask]
  );

  const clearFinished = () => {
    setTasks((prev) => prev.filter((t) => t.status === 'checking' || t.status === 'uploading' || t.status === 'needs-confirm'));
  };

  const busy = tasks.some((t) => t.status === 'checking' || t.status === 'uploading');
  const hasFinished = tasks.some((t) => t.status === 'success' || t.status === 'failed' || t.status === 'skipped');

  return (
    <div className="space-y-3">
      <div
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
          'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragging ? 'border-primary bg-primary-soft' : 'border-gray-300 bg-white'
        )}
      >
        {busy ? (
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        ) : (
          <UploadCloud className="h-8 w-8 text-gray-400" />
        )}
        <p className="text-sm font-medium text-navy">ファイルをドラッグ＆ドロップ、またはクリックして選択</p>
        <p className="text-xs text-gray-500">PDF・PNG・JPEG・WebP／1ファイル20MBまで／複数選択可</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILE_ACCEPT}
          className="hidden"
          id="upload-zone-input"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
        <label
          htmlFor="upload-zone-input"
          className="mt-1 cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-deep"
        >
          ファイルを選択
        </label>
      </div>

      {tasks.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white">
          <ul className="divide-y divide-gray-100">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-navy">{t.file.name}</p>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                    {t.status === 'checking' && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
                    {t.status === 'uploading' && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                    {t.status === 'success' && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                    {(t.status === 'failed' || t.status === 'needs-confirm') && (
                      <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                    )}
                    {t.status === 'skipped' && <X className="h-3.5 w-3.5 text-gray-400" />}
                    <span
                      className={cn(
                        'text-gray-500',
                        t.status === 'success' && 'text-success',
                        (t.status === 'failed' || t.status === 'needs-confirm') && 'text-warning'
                      )}
                    >
                      {STATUS_LABEL[t.status]}
                      {t.status === 'failed' && t.error ? `：${t.error}` : ''}
                    </span>
                  </div>
                </div>
                {t.status === 'needs-confirm' && (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="secondary" onClick={() => updateTask(t.id, { status: 'skipped' })}>
                      スキップ
                    </Button>
                    <Button size="sm" onClick={() => void uploadTask(t.id, t.file)}>
                      続行
                    </Button>
                  </div>
                )}
                {t.status === 'failed' && (
                  <button
                    type="button"
                    onClick={() => setTasks((prev) => prev.filter((x) => x.id !== t.id))}
                    aria-label="削除"
                    className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {hasFinished && !busy && (
            <div className="flex justify-end border-t border-gray-100 px-4 py-2">
              <Button size="sm" variant="secondary" onClick={clearFinished}>
                完了分をクリア
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
