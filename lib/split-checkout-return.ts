export function splitCheckoutUrl(newOrderId: string, from: string) {
  return `/app/pos?${new URLSearchParams({ order: newOrderId, checkout: '1', from })}`;
}

export function splitCheckoutReturn(
  from: string | undefined,
  order: { id: string; status: string; total: number } | null,
  hasActiveItems: boolean
) {
  if (!from || !order || order.id !== from || order.status !== 'open' || !hasActiveItems || !Number.isFinite(order.total) || order.total < 0) return null;
  return { href: `/app/pos?${new URLSearchParams({ order: from, checkout: '1' })}`, total: order.total };
}
