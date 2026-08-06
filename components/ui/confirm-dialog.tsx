'use client';

import { useState } from 'react';
import { Dialog } from './dialog';
import { Button } from './button';
import { Textarea, Label } from './input';

/**
 * 破壊的操作の確認ダイアログ。理由入力を必須にできる。
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  message,
  confirmLabel = '実行する',
  requireReason = false,
  destructive = true,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  requireReason?: boolean;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (requireReason && !reason.trim()) return;
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onClose();
      setReason('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <p className="text-sm text-gray-700">{message}</p>
      {requireReason && (
        <div className="mt-4">
          <Label htmlFor="confirm-reason">理由（必須・操作履歴に記録されます）</Label>
          <Textarea
            id="confirm-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="理由を入力してください"
          />
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          キャンセル
        </Button>
        <Button
          variant={destructive ? 'danger' : 'primary'}
          onClick={handleConfirm}
          disabled={busy || (requireReason && !reason.trim())}
        >
          {busy ? '処理中…' : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
