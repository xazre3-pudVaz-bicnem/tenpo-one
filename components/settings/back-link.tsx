import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export function SettingsBackLink() {
  return (
    <Link
      href="/app/settings"
      className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-primary"
    >
      <ChevronLeft className="h-4 w-4" />
      設定へ戻る
    </Link>
  );
}
