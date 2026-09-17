import { Badge, type BadgeTone } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** CSV出力などで使う正式な状態名 */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  open: '会計前',
  paid: '会計済',
  refunded: '返金済',
  cancelled: '取消',
  void: '無効',
};

/** 画面のチップ表示用（プロトタイプに合わせて会計前は「未会計」） */
const ORDER_STATUS_CHIP_LABELS: Record<string, string> = { ...ORDER_STATUS_LABELS, open: '未会計' };

const ORDER_STATUS_TONES: Record<string, BadgeTone> = {
  open: 'warning',
  paid: 'success',
  refunded: 'primary',
  cancelled: 'danger',
  void: 'gray',
};

export function OrderStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={ORDER_STATUS_TONES[status] ?? 'gray'} className={cn('font-bold', className)}>
      {ORDER_STATUS_CHIP_LABELS[status] ?? status}
    </Badge>
  );
}
