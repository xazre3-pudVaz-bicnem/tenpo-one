'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** 発注書印刷ボタン。ページ下部の .print-area のみを window.print() で出力する */
export function PoPrintButton() {
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()}>
      <Printer className="h-4 w-4" />
      印刷
    </Button>
  );
}
