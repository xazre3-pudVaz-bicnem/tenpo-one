import { Badge, type BadgeTone } from '@/components/ui/badge';

export const ORDER_STATUS_LABELS: Record<string, string> = {
  open: '会計前',
  paid: '会計済',
  refunded: '返金済',
  cancelled: '取消',
  void: '無効',
};

const ORDER_STATUS_TONES: Record<string, BadgeTone> = {
  open: 'warning',
  paid: 'success',
  refunded: 'primary',
  cancelled: 'danger',
  void: 'gray',
};

export function OrderStatusBadge({ status }: { status: string }) {
  return <Badge tone={ORDER_STATUS_TONES[status] ?? 'gray'}>{ORDER_STATUS_LABELS[status] ?? status}</Badge>;
}
