import type { LucideIcon } from 'lucide-react';

export interface FeatureItem {
  icon: LucideIcon;
  title: string;
  desc: string;
}

export function FeatureGrid({ items }: { items: FeatureItem[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.title} className="rounded-2xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary-deep">
            <item.icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-bold text-navy">{item.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">{item.desc}</p>
        </div>
      ))}
    </div>
  );
}
