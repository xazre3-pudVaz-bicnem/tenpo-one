'use client';

import { useEffect } from 'react';
import { markPrintJobPrinted } from '@/app/app/settings/printers/actions';

/** マウント時に印刷ダイアログを開き、印刷完了を記録する */
export function PrintTrigger({ jobId }: { jobId: string }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      window.print();
      void markPrintJobPrinted(jobId);
    }, 200);
    return () => clearTimeout(timer);
  }, [jobId]);

  return null;
}
