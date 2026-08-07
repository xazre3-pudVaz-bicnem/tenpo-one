'use client';

import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { qrStrings } from './strings';

/** 注文送信直後の完了画面 */
export function SuccessView({
  onViewStatus,
  onBackToMenu,
}: {
  onViewStatus: () => void;
  onBackToMenu: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-14 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success-soft">
        <CheckCircle2 className="h-9 w-9 text-success" />
      </div>
      <h2 className="mt-5 text-lg font-bold text-navy">{qrStrings.success.title}</h2>
      <p className="mt-2 text-sm text-gray-600">{qrStrings.success.description}</p>
      <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
        <Button size="lg" className="w-full" onClick={onViewStatus}>
          {qrStrings.success.viewStatus}
        </Button>
        <Button variant="secondary" size="lg" className="w-full" onClick={onBackToMenu}>
          {qrStrings.success.backToMenu}
        </Button>
      </div>
    </div>
  );
}
