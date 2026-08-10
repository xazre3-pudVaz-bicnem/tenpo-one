'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Minus, Plus, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { yen, todayJst } from '@/lib/format';
import { bookingErrorMessage, type BookingStore, type BookingSlot, type BookingCourse } from './types';
import { createBookingCheckout } from '@/app/(public)/booking-payment-actions';
import { createPublicReservation } from '@/app/(public)/booking-actions';

const SEAT_OPTIONS = [
  { value: '', label: '指定なし' },
  { value: 'table', label: 'テーブル席' },
  { value: 'counter', label: 'カウンター席' },
  { value: 'private_room', label: '個室' },
];

const PURPOSE_OPTIONS = ['デート', '接待', '記念日', '宴会・飲み会', '家族での食事', 'その他'];

function addDaysJst(days: number): string {
  const d = new Date(Date.now() + days * 86400000);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 20,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
      <span className="text-sm font-medium text-navy">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`${label}を減らす`}
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 text-navy disabled:opacity-40"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-6 text-center text-base font-semibold tabular-nums">{value}</span>
        <button
          type="button"
          aria-label={`${label}を増やす`}
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 text-navy disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function BookingWizard({ store }: { store: BookingStore }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [date, setDate] = useState(todayJst());
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [time, setTime] = useState<string | null>(null);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [courseId, setCourseId] = useState('');
  const [seatType, setSeatType] = useState('');
  const [purpose, setPurpose] = useState('');

  const [name, setName] = useState('');
  const [kana, setKana] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [allergy, setAllergy] = useState('');
  const [request, setRequest] = useState('');
  const [consent, setConsent] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [paymentOffer, setPaymentOffer] = useState<{ code: string; url: string; amount: number } | null>(null);

  const partySize = adults + children;
  const maxDate = addDaysJst(store.booking_window_days);
  const partyValid = partySize >= 1 && partySize <= store.max_party_size;
  const visibleSlots = partyValid ? slots : [];

  // コースの利用人数条件（任意）に現在の人数が合うか
  const courseFits = (c: BookingCourse) =>
    (c.min_party == null || partySize >= c.min_party) && (c.max_party == null || partySize <= c.max_party);
  const coursePartyLabel = (c: BookingCourse) => {
    if (c.min_party != null && c.max_party != null) return `${c.min_party}〜${c.max_party}名`;
    if (c.min_party != null) return `${c.min_party}名〜`;
    if (c.max_party != null) return `〜${c.max_party}名`;
    return '';
  };
  // 選択中コースが現在の人数条件に合わない場合は「未選択」として扱う（派生値。effectでのsetStateを避ける）
  const selectedCourse = store.courses.find((x) => x.id === courseId) ?? null;
  const effectiveCourseId = selectedCourse && !courseFits(selectedCourse) ? '' : courseId;

  useEffect(() => {
    if (!partyValid) return;
    let cancelled = false;
    (async () => {
      setLoadingSlots(true);
      setTime(null);
      const { data, error: rpcError } = await supabase.rpc('get_booking_availability', {
        p_slug: store.slug,
        p_date: date,
        p_party: partySize,
      });
      if (cancelled) return;
      setSlots(rpcError || !data ? [] : (data as BookingSlot[]));
      setLoadingSlots(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, partySize, store.slug, store.max_party_size, partyValid]);

  const canProceedStep1 = partyValid && !!time;
  const canSubmit = name.trim().length > 0 && phone.trim().length >= 10 && consent;

  const handleSubmit = async () => {
    if (!canSubmit || !time) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data, errorMessage } = await createPublicReservation({
        slug: store.slug,
        date,
        time,
        party: partySize,
        adults,
        children,
        name: name.trim(),
        kana: kana.trim() || null,
        phone: phone.trim(),
        email: email.trim() || null,
        courseId: effectiveCourseId || null,
        seatType: seatType || null,
        purpose: purpose || null,
        allergy: allergy.trim() || null,
        request: request.trim() || null,
        sourceCode: 'web',
        consent,
      });
      if (errorMessage || !data) {
        setError(bookingErrorMessage(errorMessage));
        setSubmitting(false);
        return;
      }
      const result = data;

      // 予約は成立済み。オンライン決済が必要な店舗設定であれば決済案内を挟む。
      // 決済案内の取得に失敗しても予約自体は成立しているため、通常の完了ページへ進む。
      try {
        const checkout = await createBookingCheckout(result.code, phone.trim());
        if (checkout.ok && checkout.url) {
          setPaymentOffer({ code: result.code, url: checkout.url, amount: checkout.amount ?? 0 });
          setSubmitting(false);
          return;
        }
      } catch {
        // 決済案内なしで完了ページへ進める
      }
      router.push(`/book/${store.slug}/complete?code=${encodeURIComponent(result.code)}`);
    } catch {
      setError(bookingErrorMessage(null));
      setSubmitting(false);
    }
  };

  if (paymentOffer) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center">
        <h2 className="text-lg font-bold text-navy">ご予約を承りました</h2>
        <p className="mt-2 text-sm text-gray-600">
          予約コード{' '}
          <span className="font-bold tracking-wider text-primary-deep tabular-nums">{paymentOffer.code}</span>
        </p>
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
          <p className="text-sm text-gray-700">
            このご予約はオンライン決済が必要です。以下のボタンからお進みください。
          </p>
          <button
            type="button"
            onClick={() => {
              window.location.href = paymentOffer.url;
            }}
            className="mt-4 h-12 w-full rounded-lg bg-primary text-sm font-semibold text-white"
          >
            オンライン決済へ進む（{yen(paymentOffer.amount)}）
          </button>
          <button
            type="button"
            onClick={() => router.push(`/book/${store.slug}/complete?code=${encodeURIComponent(paymentOffer.code)}`)}
            className="mt-4 text-xs text-gray-400 underline"
          >
            決済をスキップして完了ページへ進む
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg pb-28">
      {/* ステップインジケーター */}
      <ol className="mb-6 flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                s < step ? 'bg-primary text-white' : s === step ? 'bg-primary text-white' : 'bg-gray-200 text-gray-500'
              )}
            >
              {s < step ? <Check className="h-3.5 w-3.5" /> : s}
            </span>
            {s < 3 && <span className={cn('h-0.5 flex-1', s < step ? 'bg-primary' : 'bg-gray-200')} />}
          </li>
        ))}
      </ol>

      {error && (
        <div className="mb-4 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{error}</div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-navy">日時・人数を選択</h2>
          <div>
            <label htmlFor="booking-date" className="mb-1 block text-sm font-medium text-gray-700">
              来店日
            </label>
            <input
              id="booking-date"
              type="date"
              value={date}
              min={todayJst()}
              max={maxDate}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm focus:border-primary focus:outline-2 focus:outline-primary/30"
            />
          </div>

          <Stepper label="大人" value={adults} onChange={setAdults} min={0} max={store.max_party_size} />
          <Stepper label="子ども" value={children} onChange={setChildren} min={0} max={store.max_party_size} />

          {partySize > store.max_party_size && (
            <p className="text-xs text-danger">
              オンライン予約は最大{store.max_party_size}名までです。それ以上の場合はお電話でお問い合わせください。
            </p>
          )}
          {partySize < 1 && <p className="text-xs text-gray-500">ご人数を選択してください。</p>}

          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">ご希望の時間</p>
            {loadingSlots ? (
              <div className="flex items-center justify-center py-8 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : visibleSlots.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
                この条件でご予約可能な時間帯はありません。日付やご人数を変更してお試しください。
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {visibleSlots.map((s) => (
                  <button
                    key={s.time}
                    type="button"
                    disabled={!s.available}
                    onClick={() => setTime(s.time)}
                    className={cn(
                      'h-10 rounded-lg border text-sm font-medium tabular-nums transition-colors',
                      !s.available && 'cursor-not-allowed border-gray-100 bg-gray-50 text-gray-300 line-through',
                      s.available && time !== s.time && 'border-gray-300 text-navy hover:border-primary',
                      s.available && time === s.time && 'border-primary bg-primary text-white'
                    )}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-navy">コース・お席のご希望</h2>
          {store.courses.length > 0 && (
            <div>
              <label htmlFor="booking-course" className="mb-1 block text-sm font-medium text-gray-700">
                コース（任意）
              </label>
              <select
                id="booking-course"
                value={effectiveCourseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm"
              >
                <option value="">選択しない</option>
                {store.courses.map((c) => {
                  const fits = courseFits(c);
                  const partyLabel = coursePartyLabel(c);
                  return (
                    <option key={c.id} value={c.id} disabled={!fits}>
                      {c.name}（{yen(c.price)}）{partyLabel && `／${partyLabel}`}{!fits ? '（人数対象外）' : ''}
                    </option>
                  );
                })}
              </select>
              {effectiveCourseId && selectedCourse?.description && (
                <p className="mt-1.5 text-xs text-gray-500">{selectedCourse.description}</p>
              )}
            </div>
          )}

          <div>
            <p className="mb-1 text-sm font-medium text-gray-700">お席のご希望（任意）</p>
            <div className="grid grid-cols-2 gap-2">
              {SEAT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setSeatType(o.value)}
                  className={cn(
                    'h-11 rounded-lg border text-sm font-medium',
                    seatType === o.value ? 'border-primary bg-primary-soft text-primary-deep' : 'border-gray-300 text-navy'
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium text-gray-700">ご利用目的（任意）</p>
            <div className="flex flex-wrap gap-2">
              {PURPOSE_OPTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPurpose(purpose === p ? '' : p)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium',
                    purpose === p ? 'border-primary bg-primary-soft text-primary-deep' : 'border-gray-300 text-gray-600'
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-navy">お客様情報</h2>
          <div>
            <label htmlFor="booking-name" className="mb-1 block text-sm font-medium text-gray-700">
              お名前 <span className="text-danger">必須</span>
            </label>
            <input
              id="booking-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="山田 太郎"
              className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="booking-kana" className="mb-1 block text-sm font-medium text-gray-700">
              フリガナ
            </label>
            <input
              id="booking-kana"
              value={kana}
              onChange={(e) => setKana(e.target.value)}
              placeholder="ヤマダ タロウ"
              className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="booking-phone" className="mb-1 block text-sm font-medium text-gray-700">
              お電話番号 <span className="text-danger">必須</span>
            </label>
            <input
              id="booking-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09012345678"
              className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">予約の確認・変更・キャンセルにこの電話番号を使用します。</p>
          </div>
          <div>
            <label htmlFor="booking-email" className="mb-1 block text-sm font-medium text-gray-700">
              メールアドレス（任意）
            </label>
            <input
              id="booking-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="booking-allergy" className="mb-1 block text-sm font-medium text-gray-700">
              アレルギー（任意）
            </label>
            <textarea
              id="booking-allergy"
              value={allergy}
              onChange={(e) => setAllergy(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="booking-request" className="mb-1 block text-sm font-medium text-gray-700">
              ご要望（任意）
            </label>
            <textarea
              id="booking-request"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <label className="flex items-start gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span>
              <a href="/privacy" target="_blank" className="text-primary underline">
                個人情報の取り扱い
              </a>
              に同意する <span className="text-danger">必須</span>
            </span>
          </label>
        </div>
      )}

      {/* 予約内容サマリー */}
      {step > 1 && (
        <div className="mt-5 rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-600">
          {date.replaceAll('-', '/')}　{time}〜　大人{adults}名
          {children > 0 ? `・子ども${children}名` : ''}
        </div>
      )}

      {/* フッター操作 */}
      <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
        <div className="mx-auto flex max-w-lg gap-3">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
              className="h-12 flex-1 rounded-lg border border-gray-300 text-sm font-semibold text-navy"
            >
              戻る
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              disabled={step === 1 && !canProceedStep1}
              onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
              className="h-12 flex-1 rounded-lg bg-primary text-sm font-semibold text-white disabled:opacity-40"
            >
              次へ
            </button>
          ) : (
            <button
              type="button"
              disabled={!canSubmit || submitting}
              onClick={handleSubmit}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-white disabled:opacity-40"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              予約を確定する
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
