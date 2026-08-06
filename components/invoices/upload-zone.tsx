'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { createInboxDocument } from '@/app/app/invoices/actions';
import { ACCEPTED_FILE_ACCEPT, extFromFile, validateAttachedFile } from './labels';

/**
 * 保存ボックス用のドラッグ&ドロップアップローダー。
 * クライアントから直接Supabase Storageへアップロードし、成功したらメタデータをserver actionでdocumentsへ登録する。
 */
export function UploadZone({ organizationId, storeId }: { organizationId: string; storeId: string | null }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setUploading(true);
      const supabase = createClient();
      let okCount = 0;

      for (const file of list) {
        const validationError = validateAttachedFile(file);
        if (validationError) {
          toast(`${file.name}: ${validationError}`, 'error');
          continue;
        }
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
          toast(`${file.name} のアップロードに失敗しました`, 'error');
          continue;
        }

        try {
          await createInboxDocument({
            filePath: path,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          });
          okCount++;
        } catch {
          toast(`${file.name} の登録に失敗しました`, 'error');
        }
      }

      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
      if (okCount > 0) {
        toast(`${okCount}件のファイルを保存ボックスへアップロードしました`);
        router.refresh();
      }
    },
    [organizationId, storeId, toast, router]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void uploadFiles(e.dataTransfer.files);
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
        dragging ? 'border-primary bg-primary-soft' : 'border-gray-300 bg-white'
      )}
    >
      {uploading ? (
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
        disabled={uploading}
        onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
      />
      <label
        htmlFor="upload-zone-input"
        className="mt-1 cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-deep"
      >
        ファイルを選択
      </label>
    </div>
  );
}
