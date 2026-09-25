'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import {
  KITCHEN_TICKET_BUZZERS,
  KITCHEN_TICKET_BUZZER_LABELS,
  KITCHEN_TICKET_LANGUAGE_LABELS,
  KITCHEN_TICKET_SPLIT_LABELS,
  KITCHEN_TICKET_TEXT_SIZE_LABELS,
  KITCHEN_TICKET_TEXT_SIZES,
  type KitchenTicketBuzzer,
  type KitchenTicketLanguage,
  type KitchenTicketSettings,
  type KitchenTicketSplit,
  type KitchenTicketTextSize,
} from '@/lib/kitchen-ticket';
import { saveKitchenTicketSettings } from '@/app/app/settings/printers/actions';

const SPLIT_DESCRIPTIONS: Record<KitchenTicketSplit, string> = {
  item: '唐揚げ×2・ポテト×1 を注文 → 「唐揚げ x2」「ポテト x1」の2枚。同じ商品はまとめて1枚（x2）。',
  order: '1回の注文の商品を1枚にまとめて出します（これまでの出し方）。',
};

const SIZE_DESCRIPTIONS: Record<KitchenTicketTextSize, string> = {
  large: '商品名（英語・日本語）と卓名を縦横2倍、伝票番号・選択肢・メモを縦2倍で印字します。',
  medium:
    '商品名・選択肢・メモ・伝票番号を縦2倍（幅はふつう）、卓名だけ縦横2倍。1行に48桁入るので、長い商品名も途中で折り返しません。',
  normal: '商品名は縦2倍、日本語名・選択肢は普通の大きさ（これまでの印字）。',
};

const BUZZER_DESCRIPTIONS: Record<KitchenTicketBuzzer, string> = {
  none: '音は鳴りません（これまでの動き）。',
  drawer1:
    '伝票が出るとき、プリンターのドロア／ブザー端子につないだブザーを鳴らします。1回の注文につき1度だけ鳴ります。',
  drawer2: '鳴らない場合はこちら。同じ端子でも配線（ピン）が違うことがあります。',
};

const LANGUAGE_DESCRIPTIONS: Record<KitchenTicketLanguage, string> = {
  both: '「Water x2」の下に「水」のように、英語の下に日本語も出します。',
  en: '「Water x2」だけ。見出しの日本語（ドリンク 伝票・取消など）も出しません。英語名の無い商品は日本語で出します。',
};

function RadioCard<T extends string>({
  name,
  value,
  checked,
  label,
  description,
  onChange,
}: {
  name: string;
  value: T;
  checked: boolean;
  label: string;
  description: string;
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3 text-sm text-gray-700 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="mt-0.5 h-4 w-4 border-gray-300 text-primary focus:ring-primary"
      />
      <span>
        <span className="block font-medium text-navy">{label}</span>
        <span className="mt-0.5 block text-xs text-gray-500">{description}</span>
      </span>
    </label>
  );
}

/**
 * 厨房伝票（キッチン・ドリンクのプリンター）の分け方・文字の大きさ・商品名の言語。店舗ごとの設定で、全キッチン機に効く。
 * 既定は「商品の種類ごとに1枚ずつ」「大きめ」「英語と日本語」（2026-09-21 店舗要望）。
 * 文字の大きさは 大きめ（Word の16くらい）／中くらい（Word の12くらい）／標準（これまで）。
 */
export function KitchenTicketPanel({ storeId, initial }: { storeId: string; initial: KitchenTicketSettings }) {
  const { toast } = useToast();
  const [split, setSplit] = useState<KitchenTicketSplit>(initial.split);
  const [textSize, setTextSize] = useState<KitchenTicketTextSize>(initial.textSize);
  const [language, setLanguage] = useState<KitchenTicketLanguage>(initial.language);
  const [buzzer, setBuzzer] = useState<KitchenTicketBuzzer>(initial.buzzer);
  const [pending, startTransition] = useTransition();
  const changed =
    split !== initial.split ||
    textSize !== initial.textSize ||
    language !== initial.language ||
    buzzer !== initial.buzzer;

  const save = () => {
    startTransition(async () => {
      const result = await saveKitchenTicketSettings(storeId, { split, textSize, language, buzzer });
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('厨房伝票の設定を保存しました（次の注文から反映）');
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-navy">厨房伝票</p>
          <Badge tone="gray">キッチン・ドリンク</Badge>
        </div>

        <div className="space-y-2" role="radiogroup" aria-label="厨房伝票の分け方">
          <p className="text-xs font-semibold text-gray-600">分け方</p>
          {(['item', 'order'] as const).map((value) => (
            <RadioCard
              key={value}
              name="kitchen-ticket-split"
              value={value}
              checked={split === value}
              label={KITCHEN_TICKET_SPLIT_LABELS[value]}
              description={SPLIT_DESCRIPTIONS[value]}
              onChange={setSplit}
            />
          ))}
        </div>

        <div className="space-y-2" role="radiogroup" aria-label="厨房伝票の文字の大きさ">
          <p className="text-xs font-semibold text-gray-600">文字の大きさ</p>
          {KITCHEN_TICKET_TEXT_SIZES.map((value) => (
            <RadioCard
              key={value}
              name="kitchen-ticket-text-size"
              value={value}
              checked={textSize === value}
              label={KITCHEN_TICKET_TEXT_SIZE_LABELS[value]}
              description={SIZE_DESCRIPTIONS[value]}
              onChange={setTextSize}
            />
          ))}
        </div>

        <div className="space-y-2" role="radiogroup" aria-label="厨房伝票の商品名の言語">
          <p className="text-xs font-semibold text-gray-600">商品名の言語</p>
          {(['both', 'en'] as const).map((value) => (
            <RadioCard
              key={value}
              name="kitchen-ticket-language"
              value={value}
              checked={language === value}
              label={KITCHEN_TICKET_LANGUAGE_LABELS[value]}
              description={LANGUAGE_DESCRIPTIONS[value]}
              onChange={setLanguage}
            />
          ))}
        </div>

        <div className="space-y-2" role="radiogroup" aria-label="厨房伝票のブザー">
          <p className="text-xs font-semibold text-gray-600">印刷時のブザー</p>
          {KITCHEN_TICKET_BUZZERS.map((value) => (
            <RadioCard
              key={value}
              name="kitchen-ticket-buzzer"
              value={value}
              checked={buzzer === value}
              label={KITCHEN_TICKET_BUZZER_LABELS[value]}
              description={BUZZER_DESCRIPTIONS[value]}
              onChange={setBuzzer}
            />
          ))}
          <p className="text-xs text-gray-500">
            音はプリンター本体ではなく、ドロア／ブザー端子につないだブザーが鳴らします（ブザーが付いていないと鳴りません）。
          </p>
        </div>

        <p className="text-xs text-gray-500">
          1回の注文の伝票は続けて出て、1枚ごとに紙が切れます。どのプリンターに出るかは、各プリンターの「伝票種別」（キッチン／ドリンク／デザート）とカテゴリの厨房ステーションで決まります。
        </p>
        <Button size="sm" onClick={save} disabled={pending || !changed}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          設定を保存
        </Button>
      </CardContent>
    </Card>
  );
}
