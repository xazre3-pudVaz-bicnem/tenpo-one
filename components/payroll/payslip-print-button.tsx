'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** 給与明細の印刷ボタン。.print-area のみを window.print() で出力する。PDF保存はブラウザの印刷ダイアログから行う */
export function PayslipPrintButton() {
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer className="h-3.5 w-3.5" />
      印刷する（PDF保存はブラウザの印刷画面から）
    </Button>
  );
}
