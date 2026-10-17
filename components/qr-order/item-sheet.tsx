'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Textarea, Label } from '@/components/ui/input';
import { yen } from '@/lib/format';
import { useQrStrings, useQrLocale, localizedName } from './strings-context';
import { MAX_LINE_QUANTITY } from './logic';
import { isPublicImageUrl, optionSelectionError, type QrMenuItem, type QrMenuModifier, type QrOptionGroup } from './types';
import { DishArt, PrimaryButton } from './ui';

/**
 * メニュー商品をタップした際に開く、数量・オプション・メモ入力シート。
 * 選択肢グループ（レジ・ハンディと同じ 設定 > メニュー選択肢：ナン/ライス・辛さ・ランチドリンクなど）は
 * 1つだけ選ぶグループはラジオ、複数選べるグループはチェックで出す（2026-10-17 Ronnie「レジにあるものをそのまま QR にも」）。
 * 必須のグループが未選択のあいだは「カートに追加」を押せない。
 */
export function ItemSheet({
  item,
  onClose,
  onAdd,
}: {
  item: QrMenuItem;
  onClose: () => void;
  onAdd: (quantity: number, memo: string, modifiers: QrMenuModifier[]) => void;
}) {
  const qrStrings = useQrStrings();
  const locale = useQrLocale();
  const displayName = localizedName(locale, item.name, item.name_en);
  const [quantity, setQuantity] = useState(1);
  const [memo, setMemo] = useState('');
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);
  const groups: QrOptionGroup[] = (item.option_groups ?? []).filter((g) => g.items.length > 0);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);

  const selectedModifiers = item.modifiers.filter((m) => selectedModifierIds.includes(m.id));
  // 選択肢グループの選択（グループの順のまま。kind='option' で古い modifiers と区別する）
  const selectedOptions: QrMenuModifier[] = groups.flatMap((g) =>
    g.items.filter((o) => selectedOptionIds.includes(o.id)).map((o) => ({ id: o.id, name: o.name, name_en: o.name_en, price: o.price, kind: 'option' as const }))
  );
  const unitPrice = item.price + [...selectedOptions, ...selectedModifiers].reduce((sum, m) => sum + m.price, 0);
  const missingGroup = optionSelectionError(groups, selectedOptionIds);

  const toggleModifier = (id: string) => {
    setSelectedModifierIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const pickOption = (g: QrOptionGroup, id: string) => {
    setSelectedOptionIds((prev) => {
      const inGroup = new Set(g.items.map((o) => o.id));
      if (g.max_select <= 1) {
        // 1つだけ：同じグループの他を外して入れ替える（必須でなければもう一度押すと外れる）
        const others = prev.filter((x) => !inGroup.has(x));
        return prev.includes(id) && !g.is_required ? others : [...others, id];
      }
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      const n = prev.filter((x) => inGroup.has(x)).length;
      return n >= g.max_select ? prev : [...prev, id];
    });
  };

  return (
    <Dialog open onClose={onClose} title={displayName}>
      <div className="space-y-4 text-ink">
        {isPublicImageUrl(item.image_path) ? (
          // eslint-disable-next-line @next/next/no-img-element -- 匿名向け公開URLのみ許可されるため next/image の最適化対象外
          <img
            src={item.image_path}
            alt={qrStrings.itemSheet.imageAlt(displayName)}
            className="h-40 w-full rounded-xl object-cover"
          />
        ) : (
          <DishArt className="h-40 rounded-xl" />
        )}

        {item.description && <p className="text-sm text-ink-2">{item.description}</p>}

        {item.allergy_info && (
          <div className="rounded-xl bg-danger-soft px-4 py-3">
            <p className="text-xs font-semibold text-danger">{qrStrings.itemSheet.allergyLabel}</p>
            <p className="mt-0.5 text-sm text-danger">{item.allergy_info}</p>
          </div>
        )}

        <p className="font-num text-lg font-bold tabular-nums text-[#5c5650]">
          {yen(item.price)} <span className="text-[10px] font-medium text-ink-3">{qrStrings.menu.taxIncluded}</span>
        </p>

        {groups.map((g) => {
          const single = g.max_select <= 1;
          const chosen = g.items.filter((o) => selectedOptionIds.includes(o.id)).length;
          return (
            <fieldset key={g.id} className="rounded-xl border border-line p-2">
              <legend className="flex items-center gap-2 px-1 text-sm font-bold text-ink">
                {g.name}
                <span
                  className={
                    g.is_required
                      ? 'rounded-md bg-iris px-1.5 py-0.5 text-[10px] font-bold text-white'
                      : 'rounded-md bg-lilac px-1.5 py-0.5 text-[10px] font-bold text-ink-3'
                  }
                >
                  {g.is_required ? qrStrings.itemSheet.requiredBadge : qrStrings.itemSheet.optionalBadge}
                </span>
                {!single && <span className="text-[11px] font-medium text-ink-3">{qrStrings.itemSheet.chooseUpTo(g.max_select)}</span>}
              </legend>
              <ul className="mt-1 space-y-1">
                {g.items.map((o) => {
                  const on = selectedOptionIds.includes(o.id);
                  const full = !single && !on && chosen >= g.max_select;
                  return (
                    <li key={o.id}>
                      <label
                        className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 ${on ? 'bg-[#f9ede6]' : 'hover:bg-lilac-soft'} ${full ? 'opacity-40' : ''}`}
                      >
                        <span className="flex items-center gap-2.5 text-[15px] text-ink">
                          <input
                            type={single ? 'radio' : 'checkbox'}
                            name={`og-${g.id}`}
                            className="h-5 w-5 border-line accent-[#bc5940] focus:ring-iris"
                            checked={on}
                            disabled={full}
                            onChange={() => pickOption(g, o.id)}
                            onClick={() => {
                              // ラジオはもう一度押しても onChange が来ないので、任意のグループは click で外せるようにする
                              if (single && on && !g.is_required) pickOption(g, o.id);
                            }}
                          />
                          {localizedName(locale, o.name, o.name_en)}
                        </span>
                        <span className="font-num text-sm tabular-nums text-ink-3">{o.price > 0 ? `+${yen(o.price)}` : ''}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}

        {item.modifiers.length > 0 && (
          <div>
            <Label>{qrStrings.itemSheet.modifiersLabel}</Label>
            <ul className="space-y-1.5 rounded-xl border border-line p-2">
              {item.modifiers.map((m) => (
                <li key={m.id}>
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-lilac-soft">
                    <span className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-line text-iris focus:ring-iris"
                        checked={selectedModifierIds.includes(m.id)}
                        onChange={() => toggleModifier(m.id)}
                      />
                      {m.name}
                    </span>
                    <span className="font-num text-sm tabular-nums text-ink-3">
                      {m.price > 0 ? `+${yen(m.price)}` : yen(m.price)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between rounded-xl border border-line px-4 py-3">
          <span className="text-sm font-medium text-ink">{qrStrings.itemSheet.quantityLabel}</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={qrStrings.itemSheet.decreaseAria}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-iris disabled:opacity-40"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-8 text-center font-num text-lg font-semibold tabular-nums">{quantity}</span>
            <button
              type="button"
              aria-label={qrStrings.itemSheet.increaseAria}
              onClick={() => setQuantity((q) => Math.min(MAX_LINE_QUANTITY, q + 1))}
              disabled={quantity >= MAX_LINE_QUANTITY}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-iris disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div>
          <Label htmlFor="item-memo">{qrStrings.itemSheet.memoLabel}</Label>
          <Textarea
            id="item-memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder={qrStrings.itemSheet.memoPlaceholder}
            rows={2}
          />
        </div>

        <PrimaryButton
          disabled={item.is_sold_out || !!missingGroup}
          onClick={() => onAdd(quantity, memo.trim(), [...selectedOptions, ...selectedModifiers])}
        >
          {item.is_sold_out
            ? qrStrings.itemSheet.soldOut
            : missingGroup
              ? qrStrings.itemSheet.chooseRequired(missingGroup)
              : qrStrings.itemSheet.addToCart(yen(unitPrice * quantity))}
        </PrimaryButton>
      </div>
    </Dialog>
  );
}
