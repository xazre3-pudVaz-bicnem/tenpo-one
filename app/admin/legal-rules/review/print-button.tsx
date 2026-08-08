'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** window.print() を呼ぶだけのボタン。印刷レイアウトはページ側のprint:クラスで制御する。 */
export function PrintButton() {
  return (
    <Button variant="secondary" size="sm" className="print:hidden" onClick={() => window.print()}>
      <Printer className="h-4 w-4" />
      印刷してPDF保存
    </Button>
  );
}
