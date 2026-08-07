'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error' | 'warning';
}

const ToastContext = createContext<{
  toast: (message: string, kind?: 'success' | 'error' | 'warning') => void;
}>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, kind: 'success' | 'error' | 'warning' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 sm:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg',
              t.kind === 'success' ? 'bg-navy' : t.kind === 'warning' ? 'bg-warning' : 'bg-danger'
            )}
          >
            {t.kind === 'success' ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-400" />
            ) : t.kind === 'warning' ? (
              <AlertTriangle className="h-5 w-5 shrink-0" />
            ) : (
              <XCircle className="h-5 w-5 shrink-0" />
            )}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
