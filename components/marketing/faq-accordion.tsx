'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FaqItem {
  question: string;
  answer: string;
}

/** LPのFAQ。JSON-LD(FAQPage)と同一内容を表示する（page.tsx側で二重管理しないよう配列を共有する）。 */
export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
      {items.map((item, i) => {
        const open = openIndex === i;
        return (
          <div key={item.question}>
            <button
              type="button"
              onClick={() => setOpenIndex(open ? null : i)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6"
            >
              <span className="text-sm font-semibold text-navy sm:text-base">{item.question}</span>
              <ChevronDown
                className={cn('h-5 w-5 shrink-0 text-gray-400 transition-transform', open && 'rotate-180 text-primary')}
                aria-hidden="true"
              />
            </button>
            {open && (
              <div className="px-5 pb-5 text-sm leading-relaxed text-gray-600 sm:px-6">{item.answer}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
