'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Check, Copy, ExternalLink, Link2, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import {
  bookingLinkWithSrc,
  GOOGLE_CHANNEL,
  icalFeedUrl,
  SNS_CHANNELS,
  type LinkChannel,
  type ReservationBookSettings,
} from '@/lib/reservation-book';
import { regenerateIcalToken, revokeIcalToken, saveSnsLinks } from '@/app/app/settings/reservation-book/actions';

function useCopy() {
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, label = 'リンク') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      toast(`${label}をコピーしました`);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      toast('コピーできませんでした。長押しで選択してコピーしてください', 'warning');
    }
  };
  return { copy, copied };
}

/** 経路付きの予約リンク 1 行（コピー・QR・管理画面へ） */
function ChannelLink({
  channel,
  bookingUrl,
  qrDataUrl,
  count30d,
  copy,
  copied,
}: {
  channel: LinkChannel;
  bookingUrl: string;
  qrDataUrl: string | null;
  count30d: number;
  copy: (t: string, l?: string) => void;
  copied: string | null;
}) {
  const link = bookingLinkWithSrc(bookingUrl, channel.key);
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[15px] font-bold text-navy">
          {channel.label}
          <span className="en-inline text-xs">{channel.en}</span>
        </p>
        <span className="text-[12px] text-ink-3">
          過去30日の予約 <b className="tabular-nums text-ink">{count30d}</b> 件
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{channel.howTo}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 select-all truncate rounded-lg bg-lilac px-3 py-2 font-mono text-[12.5px] text-navy">{link}</code>
        <Button size="sm" variant="secondary" onClick={() => copy(link, `${channel.label} の予約リンク`)}>
          {copied === link ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          コピー
        </Button>
        {channel.adminUrl && (
          <a
            href={channel.adminUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-white px-3 text-[13px] font-bold text-royal hover:bg-lilac-soft"
          >
            <ExternalLink className="h-4 w-4" />
            開く
          </a>
        )}
        {qrDataUrl && (
          <a href={qrDataUrl} download={`booking-${channel.key}.png`} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-white px-3 text-[13px] font-bold text-royal hover:bg-lilac-soft">
            QR
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * SNS連携（2026-09-28 Ronnie）: Instagram・LINE・Facebook・X に貼る予約リンク（経路付き）と、アカウントURLの控え。
 * リンクから入った予約は台帳の予約経路にそのSNSが付く（レジクローズの内訳にも出る）。
 */
export function SnsLinksPanel({
  storeId,
  bookingUrl,
  settings,
  qrByChannel,
  counts30d,
}: {
  storeId: string;
  bookingUrl: string;
  settings: ReservationBookSettings;
  qrByChannel: Partial<Record<string, string>>;
  counts30d: Record<string, number>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { copy, copied } = useCopy();
  const [pending, startTransition] = useTransition();
  const [sns, setSns] = useState<ReservationBookSettings['sns']>(settings.sns);

  const save = () =>
    startTransition(async () => {
      const r = await saveSnsLinks(storeId, sns);
      if (r.error) return toast(r.error, 'error');
      toast('SNS のアカウントを保存しました');
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-royal" aria-hidden />
            SNS に貼る予約リンク
            <span className="en-inline text-xs">Booking links</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed text-ink-2">
            各 SNS に下のリンクを貼ると、そこから入った予約が<b>その SNS の予約</b>として台帳に記録されます（レジクローズの「予約経路別」にも出ます）。
          </p>
          {SNS_CHANNELS.map((c) => (
            <ChannelLink key={c.key} channel={c} bookingUrl={bookingUrl} qrDataUrl={qrByChannel[c.key] ?? null} count30d={counts30d[c.sourceCode] ?? 0} copy={copy} copied={copied} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>お店の SNS アカウント</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[12px] text-ink-3">控えとして保存します（公式サイト・予約ページからのリンクに使います）。</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {SNS_CHANNELS.map((c) => (
              <div key={c.key}>
                <Label className="text-xs">{c.label} の URL</Label>
                <Input
                  value={sns[c.key as keyof ReservationBookSettings['sns']] ?? ''}
                  onChange={(e) => setSns((s) => ({ ...s, [c.key]: e.target.value }))}
                  placeholder={c.key === 'line' ? 'https://lin.ee/xxxxx' : `https://${c.key === 'x' ? 'x.com' : c.key + '.com'}/yourshop`}
                  className="font-mono text-[13px]"
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button onClick={save} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              保存
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Google連携（2026-09-28 Ronnie）:
 *   ① Google ビジネスプロフィールの「予約」ボタンに貼る予約リンク（経路 = Google）
 *   ② Google カレンダーに台帳の予約を出す（iCal 購読URL）
 */
export function GoogleLinksPanel({
  storeId,
  bookingUrl,
  siteUrl,
  settings,
  qrDataUrl,
  count30d,
}: {
  storeId: string;
  bookingUrl: string;
  siteUrl: string;
  settings: ReservationBookSettings;
  qrDataUrl: string | null;
  count30d: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { copy, copied } = useCopy();
  const [pending, startTransition] = useTransition();
  const feed = settings.icalToken ? icalFeedUrl(siteUrl, settings.icalToken) : null;

  const regenerate = (first: boolean) =>
    startTransition(async () => {
      if (!first && !confirm('購読URLを作り直します。Google カレンダーに登録した古いURLは止まるので、登録し直しが必要です。よろしいですか？')) return;
      const r = await regenerateIcalToken(storeId);
      if (r.error) return toast(r.error, 'error');
      toast(first ? '購読URLを作りました' : '購読URLを作り直しました');
      router.refresh();
    });
  const revoke = () =>
    startTransition(async () => {
      if (!confirm('Google カレンダーへの配信を止めます（URLが無効になります）。よろしいですか？')) return;
      const r = await revokeIcalToken(storeId);
      if (r.error) return toast(r.error, 'error');
      toast('配信を止めました');
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-royal" aria-hidden />
            Google 検索・マップの「予約」ボタン
            <span className="en-inline text-xs">Reserve on Google</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed text-ink-2">
            Google ビジネスプロフィールに下のリンクを入れると、Google 検索・Google マップの店舗情報に「予約」ボタンが出て、そこからの予約は<b>Google の予約</b>として台帳に記録されます。
          </p>
          <ChannelLink channel={GOOGLE_CHANNEL} bookingUrl={bookingUrl} qrDataUrl={qrDataUrl} count30d={count30d} copy={copy} copied={copied} />
          <ol className="list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed text-ink-2">
            <li>Google ビジネスプロフィール（business.google.com）で店舗を開く</li>
            <li>「予約」→「予約リンクを追加」→ 上のリンクを貼って保存</li>
            <li>数日で Google 検索・マップに「予約」ボタンが出ます（Google の審査あり）</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-royal" aria-hidden />
            Google カレンダーに予約を表示
            <span className="en-inline text-xs">Calendar feed</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed text-ink-2">
            台帳の予約（30日前〜90日先。新規・変更・キャンセル）を Google カレンダーで見られるようにします。
            スマホのカレンダーに「山田様 4名（T403）」のように出ます。Google 側の更新は数時間ごとです。
          </p>
          {!feed ? (
            <Button onClick={() => regenerate(true)} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
              購読URLを作る
            </Button>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 select-all truncate rounded-lg bg-lilac px-3 py-2 font-mono text-[12.5px] text-navy">{feed}</code>
                <Button size="sm" variant="secondary" onClick={() => copy(feed, '購読URL')}>
                  {copied === feed ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  コピー
                </Button>
                <Button size="sm" variant="ghost" onClick={() => regenerate(false)} disabled={pending} title="作り直す">
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={revoke} disabled={pending} title="配信を止める">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <ol className="list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed text-ink-2">
                <li>パソコンで Google カレンダーを開く → 左の「他のカレンダー」の「＋」→「URL で追加」</li>
                <li>上の購読URLを貼って「カレンダーを追加」</li>
                <li>スマホの Google カレンダーにも同じカレンダーが出ます（設定で表示をオンに）</li>
              </ol>
              <p className="text-[11px] text-ink-3">※ このURLを知っている人は予約が見られます。外に出さないでください。漏れたら「作り直す」で無効にできます。</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
