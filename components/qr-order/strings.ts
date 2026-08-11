/**
 * QRオーダーの表示文字列。ja / en を提供し、UI文言のみ切替可能にする。
 * 商品名・カテゴリ名・価格は実データ（menu master）のため翻訳しない。
 */
export type QrLocale = 'ja' | 'en';

const ja = {
  header: {
    orderTab: 'メニュー',
    statusTab: '注文状況',
  },
  menu: {
    empty: '現在ご注文いただけるメニューがありません。店員にお声がけください。',
    categoryEmpty: 'このカテゴリに商品がありません',
    recommendedCategoryName: 'おすすめ',
    recommendedBadge: 'おすすめ',
    soldOutBadge: '品切れ',
  },
  itemSheet: {
    quantityLabel: '数量',
    decreaseAria: '数量を減らす',
    increaseAria: '数量を増やす',
    memoLabel: 'ご要望（任意）',
    memoPlaceholder: '例）ネギ抜きでお願いします',
    allergyLabel: 'アレルギー情報',
    modifiersLabel: 'オプション',
    addToCart: (total: string) => `カートに追加（${total}）`,
    imageAlt: (name: string) => `${name}の写真`,
  },
  cartBar: {
    unit: '点',
    order: '注文する',
  },
  confirm: {
    title: 'ご注文内容の確認',
    description: '内容をご確認のうえ、注文を確定してください。',
    removeAria: (name: string) => `${name}をカートから削除`,
    total: '合計',
    back: '戻る',
    submit: 'この内容で注文する',
  },
  success: {
    title: 'ご注文を受け付けました',
    description: 'お料理をお待ちください',
    viewStatus: '注文状況を確認する',
    backToMenu: 'メニューに戻る',
  },
  status: {
    titleSuffix: 'のご注文',
    empty: 'まだご注文がありません',
    orderedAtSuffix: '注文',
    total: '現在の合計',
    callStaff: '店員を呼ぶ',
    callNotice: 'お近くの店員にお声がけください',
    payNotice: 'お会計はレジまたは店員にお申し付けください',
    fetchError: '注文状況を取得できませんでした',
  },
};

export type QrStrings = typeof ja;

const en: QrStrings = {
  header: {
    orderTab: 'Menu',
    statusTab: 'Order Status',
  },
  menu: {
    empty: 'No items are available right now. Please ask our staff.',
    categoryEmpty: 'No items in this category',
    recommendedCategoryName: 'Recommended',
    recommendedBadge: 'Popular',
    soldOutBadge: 'Sold out',
  },
  itemSheet: {
    quantityLabel: 'Quantity',
    decreaseAria: 'Decrease quantity',
    increaseAria: 'Increase quantity',
    memoLabel: 'Request (optional)',
    memoPlaceholder: 'e.g. No green onions, please',
    allergyLabel: 'Allergy info',
    modifiersLabel: 'Options',
    addToCart: (total: string) => `Add to cart (${total})`,
    imageAlt: (name: string) => `Photo of ${name}`,
  },
  cartBar: {
    unit: 'items',
    order: 'Order',
  },
  confirm: {
    title: 'Confirm your order',
    description: 'Please review the details and place your order.',
    removeAria: (name: string) => `Remove ${name} from cart`,
    total: 'Total',
    back: 'Back',
    submit: 'Place order',
  },
  success: {
    title: 'Order received',
    description: 'Your food will be served shortly.',
    viewStatus: 'View order status',
    backToMenu: 'Back to menu',
  },
  status: {
    titleSuffix: ' — Order',
    empty: 'No orders yet',
    orderedAtSuffix: 'ordered',
    total: 'Current total',
    callStaff: 'Call staff',
    callNotice: 'Please let a nearby staff member know',
    payNotice: 'Please pay at the register or ask our staff',
    fetchError: 'Could not load order status',
  },
};

export const QR_STRINGS: Record<QrLocale, QrStrings> = { ja, en };

/** 既存インポート互換（ja 既定） */
export const qrStrings = ja;
