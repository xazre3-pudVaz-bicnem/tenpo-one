'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import {
  saveCompanyStep,
  saveStoreStep,
  saveHoursStep,
  advancePaymentsStep,
  saveRegisterStep,
  completeOnboarding,
  skipOnboardingStep,
  type BusinessHourStepInput,
} from './actions';
import { StepTables } from './steps/step-tables';
import { StepCategories } from './steps/step-categories';
import { StepItems } from './steps/step-items';
import { StepStaff } from './steps/step-staff';

export interface OnboardingInitialData {
  step: number;
  completed: boolean;
  company: { name: string; nameKana: string; postalCode: string; address: string; phone: string };
  store: { id: string; name: string; address: string; phone: string; slug: string } | null;
  hours: BusinessHourStepInput[];
  existingTablesCount: number;
  existingCategories: { id: string; name: string }[];
  existingItemsCount: number;
  existingStaffCount: number;
  existingRegisterCount: number;
}

const STEP_TITLES = [
  '会社情報',
  '店舗情報',
  '営業時間',
  'テーブル・席',
  '商品カテゴリー',
  '商品登録',
  'スタッフ',
  '支払方法',
  'レジ設定',
  '完了',
];

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export function OnboardingWizard({ initial }: { initial: OnboardingInitialData }) {
  const [step, setStep] = useState(() => Math.min(10, Math.max(1, initial.step)));
  const [storeId, setStoreId] = useState(initial.store?.id ?? null);
  const [categories, setCategories] = useState(initial.existingCategories);
  const router = useRouter();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-navy">初期導入ウィザード</h1>
        <p className="mt-1 text-sm text-gray-500">
          ステップ {step} / 10 — {STEP_TITLES[step - 1]}
        </p>
        <ProgressBar step={step} />
      </div>

      {step === 1 && <StepCompany initial={initial.company} onAdvance={setStep} />}
      {step === 2 && (
        <StepStore
          initial={initial.store}
          onAdvance={(next, newStoreId) => {
            if (newStoreId) setStoreId(newStoreId);
            setStep(next);
          }}
        />
      )}
      {step === 3 && <StepHours storeId={storeId} initial={initial.hours} onAdvance={setStep} />}
      {step === 4 && <StepTables storeId={storeId} existingCount={initial.existingTablesCount} onAdvance={setStep} />}
      {step === 5 && (
        <StepCategories
          storeId={storeId}
          onAdvance={setStep}
          onCreated={(created) => setCategories((prev) => [...prev, ...created])}
        />
      )}
      {step === 6 && (
        <StepItems storeId={storeId} categories={categories} existingCount={initial.existingItemsCount} onAdvance={setStep} />
      )}
      {step === 7 && <StepStaff onAdvance={setStep} />}
      {step === 8 && <StepPayments onAdvance={setStep} />}
      {step === 9 && (
        <StepRegister storeId={storeId} existingCount={initial.existingRegisterCount} onAdvance={setStep} />
      )}
      {step === 10 && (
        <StepComplete storeSlug={initial.store?.slug ?? null} onDone={() => router.push('/app/dashboard')} />
      )}
    </div>
  );
}

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="mt-4 flex gap-1" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={10}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <div
          key={n}
          className={cn('h-1.5 flex-1 rounded-full transition-colors', n <= step ? 'bg-primary' : 'bg-gray-200')}
        />
      ))}
    </div>
  );
}

function StepFooter({
  pending,
  onSkip,
  nextLabel = '次へ',
  showBack,
  onBack,
}: {
  pending: boolean;
  onSkip?: () => void;
  nextLabel?: string;
  showBack?: boolean;
  onBack?: () => void;
}) {
  return (
    <div className="mt-5 flex items-center justify-between gap-2">
      <div>
        {showBack && (
          <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
            戻る
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        {onSkip && (
          <Button type="button" variant="secondary" onClick={onSkip} disabled={pending}>
            後で設定する
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? '保存中…' : nextLabel}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// STEP1: 会社情報
// ---------------------------------------------------------------
function StepCompany({
  initial,
  onAdvance,
}: {
  initial: OnboardingInitialData['company'];
  onAdvance: (next: number) => void;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await saveCompanyStep(form);
      if (res.error) return setError(res.error);
      toast('会社情報を保存しました');
      onAdvance(2);
    });
  };

  const handleSkip = () => {
    startTransition(async () => {
      await skipOnboardingStep(2);
      onAdvance(2);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>会社情報を入力してください</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="ob-company-name">会社名</Label>
            <Input id="ob-company-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ob-company-kana">会社名（カナ）</Label>
            <Input id="ob-company-kana" value={form.nameKana} onChange={(e) => set('nameKana', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="ob-company-postal">郵便番号</Label>
              <Input id="ob-company-postal" value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} placeholder="123-4567" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ob-company-address">住所</Label>
              <Input id="ob-company-address" value={form.address} onChange={(e) => set('address', e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="ob-company-phone">電話番号</Label>
            <Input id="ob-company-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <FieldError message={error ?? undefined} />
        </CardContent>
        <div className="px-5 pb-5">
          <StepFooter pending={pending} onSkip={handleSkip} />
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------
// STEP2: 店舗情報
// ---------------------------------------------------------------
function StepStore({
  initial,
  onAdvance,
}: {
  initial: OnboardingInitialData['store'];
  onAdvance: (next: number, storeId?: string) => void;
}) {
  const [form, setForm] = useState({ name: initial?.name ?? '', address: initial?.address ?? '', phone: initial?.phone ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError('店舗名を入力してください');
    startTransition(async () => {
      const res = await saveStoreStep({ storeId: initial?.id ?? null, ...form });
      if (res.error) return setError(res.error);
      toast('店舗情報を保存しました');
      onAdvance(3, res.storeId);
    });
  };

  const handleSkip = () => {
    startTransition(async () => {
      await skipOnboardingStep(3);
      onAdvance(3);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>最初の店舗を登録してください</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="ob-store-name">店舗名</Label>
            <Input id="ob-store-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ob-store-address">住所</Label>
            <Input id="ob-store-address" value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ob-store-phone">電話番号</Label>
            <Input id="ob-store-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <FieldError message={error ?? undefined} />
        </CardContent>
        <div className="px-5 pb-5">
          <StepFooter pending={pending} onSkip={handleSkip} />
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------
// STEP3: 営業時間
// ---------------------------------------------------------------
function StepHours({
  storeId,
  initial,
  onAdvance,
}: {
  storeId: string | null;
  initial: BusinessHourStepInput[];
  onAdvance: (next: number) => void;
}) {
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const update = (day: number, patch: Partial<BusinessHourStepInput>) => {
    setRows((prev) => prev.map((r) => (r.dayOfWeek === day ? { ...r, ...patch } : r)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!storeId) return setError('先に店舗情報を登録してください（前のステップへ戻ってください）');
    startTransition(async () => {
      const res = await saveHoursStep(storeId, rows);
      if (res.error) return setError(res.error);
      toast('営業時間を保存しました');
      onAdvance(4);
    });
  };

  const handleSkip = () => {
    startTransition(async () => {
      await skipOnboardingStep(4);
      onAdvance(4);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>曜日別の営業時間（既定 11:00〜22:00）</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-3">
          {rows.map((r) => (
            <div key={r.dayOfWeek} className="grid grid-cols-2 items-center gap-3 border-b border-gray-100 pb-3 last:border-0 sm:grid-cols-5">
              <p className="font-medium text-navy">{WEEKDAY_LABELS[r.dayOfWeek]}曜日</p>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  checked={r.isClosed}
                  onChange={(e) => update(r.dayOfWeek, { isClosed: e.target.checked })}
                />
                定休日
              </label>
              <div>
                <Label className="text-xs">開店</Label>
                <Input type="time" disabled={r.isClosed} value={r.openTime ?? ''} onChange={(e) => update(r.dayOfWeek, { openTime: e.target.value })} />
              </div>
              <div className="col-span-2 sm:col-span-2">
                <Label className="text-xs">閉店</Label>
                <Input type="time" disabled={r.isClosed} value={r.closeTime ?? ''} onChange={(e) => update(r.dayOfWeek, { closeTime: e.target.value })} />
              </div>
            </div>
          ))}
          <FieldError message={error ?? undefined} />
        </CardContent>
        <div className="px-5 pb-5">
          <StepFooter pending={pending} onSkip={handleSkip} />
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------
// STEP8: 支払方法（案内のみ）
// ---------------------------------------------------------------
function StepPayments({ onAdvance }: { onAdvance: (next: number) => void }) {
  const [pending, startTransition] = useTransition();

  const handleNext = () => {
    startTransition(async () => {
      await advancePaymentsStep();
      onAdvance(9);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>支払方法について</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-relaxed text-gray-700">
        <p>現金・クレジットカード・QRコード決済などは、追加設定なしでPOSレジからすぐにご利用いただけます。</p>
        <p>
          クレジットカードやQR決済の実店舗決済端末との連携（Stripe連携）が必要な場合は、後から「設定 &gt; 決済・端末」画面で設定できます。
        </p>
      </CardContent>
      <div className="px-5 pb-5">
        <div className="mt-2 flex justify-end">
          <Button onClick={handleNext} disabled={pending}>
            {pending ? '処理中…' : '次へ'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------
// STEP9: レジ設定
// ---------------------------------------------------------------
function StepRegister({
  storeId,
  existingCount,
  onAdvance,
}: {
  storeId: string | null;
  existingCount: number;
  onAdvance: (next: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleNext = () => {
    setError(null);
    if (!storeId) return setError('先に店舗情報を登録してください（前のステップへ戻ってください）');
    startTransition(async () => {
      const res = await saveRegisterStep(storeId);
      if (res.error) return setError(res.error);
      toast(existingCount > 0 ? '次へ進みます' : 'レジ1を作成しました');
      onAdvance(10);
    });
  };

  const handleSkip = () => {
    startTransition(async () => {
      await skipOnboardingStep(10);
      onAdvance(10);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>レジ設定</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-relaxed text-gray-700">
        {existingCount > 0 ? (
          <p>すでにレジが{existingCount}台登録されています。追加のレジは「設定 &gt; レジ・プリンター」から登録できます。</p>
        ) : (
          <p>「レジ1」を自動作成します。営業開始前に、レジ担当者が釣銭準備金（つり銭用の現金）をレジ締め画面から登録してください。</p>
        )}
        <FieldError message={error ?? undefined} />
      </CardContent>
      <div className="px-5 pb-5">
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={handleSkip} disabled={pending}>
            後で設定する
          </Button>
          <Button onClick={handleNext} disabled={pending}>
            {pending ? '処理中…' : '次へ'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------
// STEP10: 完了
// ---------------------------------------------------------------
function StepComplete({ storeSlug, onDone }: { storeSlug: string | null; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const { toast } = useToast();

  const handleComplete = () => {
    startTransition(async () => {
      const res = await completeOnboarding();
      if (res.error) {
        toast(res.error, 'error');
        return;
      }
      setDone(true);
      toast('初期設定が完了しました');
    });
  };

  const NEXT_ACTIONS = [
    storeSlug ? { label: '予約を試す', href: `/book/${storeSlug}`, external: true } : null,
    { label: 'POSを試す', href: '/app/pos', external: false },
    { label: 'スタッフ打刻', href: '/app/attendance', external: false },
    { label: 'QRコードを表示（テーブル）', href: '/app/settings/tables', external: false },
  ].filter((a): a is { label: string; href: string; external: boolean } => a !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>おつかれさまでした</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-relaxed text-gray-700">
        <p className="flex items-center gap-2 font-medium text-navy">
          <Check className="h-5 w-5 text-success" />
          初期設定はこれで完了です
        </p>
        <p>会社情報・店舗・営業時間・テーブル・商品・スタッフなどは、いつでも「設定」画面から変更できます。</p>

        {done && (
          <div className="rounded-xl border border-gray-200 bg-surface p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">次にやること</p>
            <ul className="space-y-1.5">
              {NEXT_ACTIONS.map((a) =>
                a.external ? (
                  <li key={a.href}>
                    <a
                      href={a.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {a.label} →
                    </a>
                  </li>
                ) : (
                  <li key={a.href}>
                    <Link href={a.href} className="text-sm font-medium text-primary hover:underline">
                      {a.label} →
                    </Link>
                  </li>
                )
              )}
            </ul>
          </div>
        )}
      </CardContent>
      <div className="px-5 pb-5">
        <div className="flex justify-end">
          <Button onClick={done ? onDone : handleComplete} disabled={pending}>
            {pending ? '処理中…' : done ? 'ダッシュボードへ' : '完了する'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
