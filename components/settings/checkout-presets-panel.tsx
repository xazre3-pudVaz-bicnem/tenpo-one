'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import {
  BRANDED_METHODS,
  DISCOUNT_KIND_LABELS,
  discountPresetsOf,
  methodBrandsOf,
  nextPresetKey,
  pointBrandsOf,
  PRESET_MAX,
  PRESET_NAME_MAX,
  type BrandedMethod,
  type CheckoutPresets,
  type DiscountPreset,
  type DiscountPresetKind,
  type PointBrand,
} from '@/lib/checkout-presets';
import { METHOD_LABELS } from '@/components/cash/labels';
import { saveCheckoutPresets } from '@/app/app/settings/payments/actions';

const KINDS: DiscountPresetKind[] = ['manual', 'percent', 'amount'];

/**
 * 会計画面の「値引き」と「ポイント」の選択肢を決める（店舗ごと）。
 * レジ（iPad）からも使うので、押すところは指で押せる高さにする。
 */
export function CheckoutPresetsPanel({ storeId, initial }: { storeId: string; initial: CheckoutPresets }) {
  const { toast } = useToast();
  // 設定していない店舗には既定（幹事様無料／ホットペッパー・ぐるなび・食べログ）を出す
  const base: CheckoutPresets = {
    discounts: discountPresetsOf(initial),
    pointBrands: pointBrandsOf(initial),
    methodBrands: Object.fromEntries(BRANDED_METHODS.map((m) => [m, methodBrandsOf(initial, m)])),
  };
  const [discounts, setDiscounts] = useState<DiscountPreset[]>(base.discounts);
  const [brands, setBrands] = useState<PointBrand[]>(base.pointBrands);
  const [methods, setMethods] = useState<Record<string, PointBrand[]>>(base.methodBrands);
  const [pending, startTransition] = useTransition();

  const dirty =
    JSON.stringify({ discounts, brands, methods }) !==
    JSON.stringify({ discounts: base.discounts, brands: base.pointBrands, methods: base.methodBrands });

  const save = () => {
    const allBrands = [...brands, ...Object.values(methods).flat()];
    if (discounts.some((d) => !d.name.trim()) || allBrands.some((b) => !b.name.trim())) {
      toast('名前を入れてください', 'error');
      return;
    }
    startTransition(async () => {
      const result = await saveCheckoutPresets(storeId, { discounts, pointBrands: brands, methodBrands: methods });
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('会計の選択肢を保存しました（レジにすぐ反映）');
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>会計の「値引き」「ポイント」の選択肢</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-xs text-gray-600">
          レジの会計画面に出るボタンです。グルメサイトのクーポン（幹事様無料など）や、ホットペッパー・ぐるなび・食べログの
          ポイントをここで足せます。iPad（レジ）からも変えられます。
        </p>

        <section>
          <h3 className="mb-2 text-sm font-bold text-navy">値引きの選択肢</h3>
          <ul className="space-y-2">
            {discounts.map((d, i) => (
              <li key={d.key} className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white p-2">
                <div className="min-w-[9rem] flex-1">
                  <Label htmlFor={`d-name-${d.key}`}>名前</Label>
                  <Input
                    id={`d-name-${d.key}`}
                    value={d.name}
                    maxLength={PRESET_NAME_MAX}
                    placeholder="例: 幹事様無料"
                    className="h-11"
                    onChange={(e) =>
                      setDiscounts((list) => list.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))
                    }
                  />
                </div>
                <div className="w-[11rem]">
                  <Label htmlFor={`d-kind-${d.key}`}>引き方</Label>
                  <Select
                    id={`d-kind-${d.key}`}
                    value={d.kind}
                    className="h-11"
                    onChange={(e) =>
                      setDiscounts((list) =>
                        list.map((x, xi) =>
                          xi === i
                            ? { ...x, kind: e.target.value as DiscountPresetKind, value: e.target.value === 'manual' ? 0 : x.value || 1 }
                            : x
                        )
                      )
                    }
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {DISCOUNT_KIND_LABELS[k]}
                      </option>
                    ))}
                  </Select>
                </div>
                {d.kind !== 'manual' && (
                  <div className="w-[7rem]">
                    <Label htmlFor={`d-value-${d.key}`}>{d.kind === 'percent' ? '％' : '円'}</Label>
                    <Input
                      id={`d-value-${d.key}`}
                      type="number"
                      min={1}
                      max={d.kind === 'percent' ? 100 : 1000000}
                      value={d.value}
                      className="h-11"
                      onChange={(e) =>
                        setDiscounts((list) =>
                          list.map((x, xi) => (xi === i ? { ...x, value: Number(e.target.value) } : x))
                        )
                      }
                    />
                  </div>
                )}
                <Button
                  variant="outline"
                  className="h-11"
                  aria-label={`${d.name || '値引き'}を消す`}
                  onClick={() => setDiscounts((list) => list.filter((_, xi) => xi !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            className="mt-2 h-11"
            disabled={discounts.length >= PRESET_MAX}
            onClick={() =>
              setDiscounts((list) => [...list, { key: nextPresetKey(list, 'disc'), name: '', kind: 'manual', value: 0 }])
            }
          >
            <Plus className="h-4 w-4" />
            値引きを追加
          </Button>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-bold text-navy">ポイントの選択肢</h3>
          <ul className="space-y-2">
            {brands.map((b, i) => (
              <li key={b.key} className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white p-2">
                <div className="min-w-[9rem] flex-1">
                  <Label htmlFor={`b-name-${b.key}`}>名前</Label>
                  <Input
                    id={`b-name-${b.key}`}
                    value={b.name}
                    maxLength={PRESET_NAME_MAX}
                    placeholder="例: ホットペッパー"
                    className="h-11"
                    onChange={(e) => setBrands((list) => list.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))}
                  />
                </div>
                <Button
                  variant="outline"
                  className="h-11"
                  aria-label={`${b.name || 'ポイント'}を消す`}
                  onClick={() => setBrands((list) => list.filter((_, xi) => xi !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            className="mt-2 h-11"
            disabled={brands.length >= PRESET_MAX}
            onClick={() => setBrands((list) => [...list, { key: nextPresetKey(list, 'pt'), name: '' }])}
          >
            <Plus className="h-4 w-4" />
            ポイントを追加
          </Button>
        </section>

        {BRANDED_METHODS.map((m: BrandedMethod) => (
          <section key={m}>
            <h3 className="mb-2 text-sm font-bold text-navy">{METHOD_LABELS[m]}の種類</h3>
            <ul className="space-y-2">
              {(methods[m] ?? []).map((b, i) => (
                <li key={b.key} className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white p-2">
                  <div className="min-w-[9rem] flex-1">
                    <Label htmlFor={`m-${m}-${b.key}`}>名前</Label>
                    <Input
                      id={`m-${m}-${b.key}`}
                      value={b.name}
                      maxLength={PRESET_NAME_MAX}
                      className="h-11"
                      onChange={(e) =>
                        setMethods((cur) => ({
                          ...cur,
                          [m]: (cur[m] ?? []).map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)),
                        }))
                      }
                    />
                  </div>
                  <Button
                    variant="outline"
                    className="h-11"
                    aria-label={`${b.name || METHOD_LABELS[m]}を消す`}
                    onClick={() => setMethods((cur) => ({ ...cur, [m]: (cur[m] ?? []).filter((_, xi) => xi !== i) }))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              className="mt-2 h-11"
              disabled={(methods[m] ?? []).length >= PRESET_MAX}
              onClick={() =>
                setMethods((cur) => ({
                  ...cur,
                  [m]: [...(cur[m] ?? []), { key: nextPresetKey(cur[m] ?? [], m), name: '' }],
                }))
              }
            >
              <Plus className="h-4 w-4" />
              {METHOD_LABELS[m]}の種類を追加
            </Button>
          </section>
        ))}

        <div className="flex items-center justify-end gap-2">
          {dirty && <span className="mr-auto text-xs text-warning">保存していない変更があります</span>}
          <Button
            variant="secondary"
            className="h-11"
            disabled={!dirty || pending}
            onClick={() => {
              setDiscounts(base.discounts);
              setBrands(base.pointBrands);
              setMethods(base.methodBrands);
            }}
          >
            元に戻す
          </Button>
          <Button className="h-11" disabled={!dirty || pending} onClick={save}>
            変更を保存
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
