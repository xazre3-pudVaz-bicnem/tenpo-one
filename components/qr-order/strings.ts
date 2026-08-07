/**
 * QRオーダーの表示文字列（ja）。ハードコードせずここに集約する。
 * 将来 en 追加時は `LOCALE` 引数を取る形へ拡張し、この構造をそのまま複製する想定。
 */
export const qrStrings = {
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
    /** 内部Storageパスはanonから見えないため、画像は絶対URL(http/https)の場合のみ表示する */
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
} as const;
