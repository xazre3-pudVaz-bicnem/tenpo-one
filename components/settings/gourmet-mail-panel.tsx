'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, ExternalLink, Loader2, Mail, RefreshCw, ChevronRight, CircleAlert, CircleCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import {
  GOURMET_SITES,
  gourmetImportAddress,
  MAIL_KIND_LABEL,
  type GourmetMailSettings,
  type GourmetSite,
  type GourmetSiteKey,
} from '@/lib/gourmet-mail';
import { markGourmetSiteRegistered, regenerateGourmetMailToken, setGourmetMailEnabled } from '@/app/app/settings/reservation-book/actions';

function jst(iso: string | null | undefined): string {
  if (!iso) return '----/--/-- --:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '----/--/-- --:--';
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

type SiteStatus = 'off' | 'registered' | 'verified';

function siteStatus(gm: GourmetMailSettings, key: GourmetSiteKey): SiteStatus {
  const s = gm.sites[key];
  if (s?.verifiedAt) return 'verified';
  if (s?.enabledAt) return 'registered';
  return 'off';
}

/**
 * グルメサイト連携（メール取り込み）の設定（2026-09-27 Ronnie）。レストランボード・TableCheck と同じ流れ:
 *   取り込み専用アドレスをコピー → 各サイトの店舗管理画面で通知先に登録 → メールが届いたら「設定済」
 */
export function GourmetMailPanel({
  storeId,
  storeName,
  settings,
  domain,
  inboundReady,
}: {
  storeId: string;
  storeName: string;
  settings: GourmetMailSettings;
  /** 取り込み用アドレスのドメイン（NEXT_PUBLIC_INBOUND_MAIL_DOMAIN） */
  domain: string;
  /** サーバーにメールの受け口（INBOUND_MAIL_SECRET）が設定されているか */
  inboundReady: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [openSite, setOpenSite] = useState<GourmetSite | null>(null);
  const [copied, setCopied] = useState(false);

  const address = settings.token ? gourmetImportAddress(settings.token, domain) : null;

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast('取り込み専用アドレスをコピーしました');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('コピーできませんでした。長押しで選択してコピーしてください', 'warning');
    }
  };

  const toggle = (enabled: boolean) =>
    startTransition(async () => {
      const r = await setGourmetMailEnabled(storeId, enabled);
      if (r.error) return toast(r.error, 'error');
      toast(enabled ? 'メール取り込みをオンにしました' : 'メール取り込みをオフにしました');
      router.refresh();
    });

  const regenerate = () =>
    startTransition(async () => {
      if (!confirm('取り込み専用アドレスを作り直します。各サイトに登録した古いアドレスには届かなくなるので、登録し直しが必要です。よろしいですか？')) return;
      const r = await regenerateGourmetMailToken(storeId);
      if (r.error) return toast(r.error, 'error');
      toast('新しいアドレスを作りました');
      router.refresh();
    });

  const mark = (site: GourmetSiteKey, registered: boolean) =>
    startTransition(async () => {
      const r = await markGourmetSiteRegistered(storeId, site, registered);
      if (r.error) return toast(r.error, 'error');
      toast(registered ? '登録した印を付けました。最初のメールが届くと「設定済」になります' : '印を外しました');
      router.refresh();
    });

  const verifiedCount = GOURMET_SITES.filter((s) => siteStatus(settings, s.key) === 'verified').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-royal" aria-hidden />
          グルメサイト連携（メール取り込み）
          <span className="en-inline text-xs">Gourmet site sync</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-2">
          食べログ・ホットペッパー・ぐるなび・一休・Retty・OZmall・ヒトサラ・LINEで予約・Google など、日本のグルメサイトの
          <b>新規予約・変更・キャンセルのメール</b>を自動で読んで、{storeName} のご予約台帳に入れます。
          各サイトの店舗管理画面で、予約通知メールの送り先に下のアドレスを登録するだけです。
        </p>

        {!inboundReady && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            メールの受け口（<code className="font-mono">{domain}</code> の MX と INBOUND_MAIL_SECRET）はまだ運営側で設定中です。
            設定が終わるまでは、アドレスを登録してもメールは取り込まれません。
          </p>
        )}

        {/* オン・オフ */}
        <div className="flex items-center justify-between rounded-xl border border-line bg-lilac-soft/60 px-4 py-3">
          <div>
            <p className="text-[15px] font-bold text-navy">グルメサイトメール取り込み</p>
            <p className="text-xs text-ink-3">{settings.enabled ? `利用中（${verifiedCount} サイト設定済）` : '停止中'}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            disabled={pending}
            onClick={() => toggle(!settings.enabled)}
            className={cn(
              'relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50',
              settings.enabled ? 'bg-iris' : 'bg-gray-300'
            )}
          >
            <span className={cn('absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all', settings.enabled ? 'left-7' : 'left-1')} />
          </button>
        </div>

        {settings.enabled && address && (
          <>
            {/* 取り込み専用アドレス */}
            <div className="rounded-xl border border-line p-3">
              <p className="mb-1.5 text-xs font-bold text-ink-3">取り込み専用メールアドレス / Import address</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 select-all rounded-lg bg-lilac px-3 py-2.5 font-mono text-[14px] text-navy">{address}</code>
                <Button variant="secondary" onClick={copy} disabled={pending}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  コピー
                </Button>
                <Button variant="ghost" size="sm" onClick={regenerate} disabled={pending} title="アドレスを作り直す">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-ink-3">
                ※ 各サイトの店舗管理画面（ID／パスワード）が必要です。登録すると、サイトから確認メールや予約メールが届いた時点で「設定済」になります。
              </p>
            </div>

            {/* サイト一覧 */}
            <ul className="divide-y divide-line rounded-xl border border-line">
              {GOURMET_SITES.map((site) => {
                const st = siteStatus(settings, site.key);
                const s = settings.sites[site.key];
                return (
                  <li key={site.key}>
                    <button
                      type="button"
                      onClick={() => setOpenSite(site)}
                      className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-lilac-soft"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-bold text-navy">{site.name}</span>
                        <span className="en-sub">{site.en}</span>
                      </span>
                      <span className="shrink-0">
                        {st === 'verified' ? (
                          <Badge tone="success" className="gap-1"><CircleCheck className="h-3.5 w-3.5" />設定済</Badge>
                        ) : st === 'registered' ? (
                          <Badge tone="warning" className="gap-1"><CircleAlert className="h-3.5 w-3.5" />メール待ち</Badge>
                        ) : (
                          <Badge tone="gray">未設定</Badge>
                        )}
                      </span>
                      <span className="hidden w-[210px] shrink-0 text-[11px] leading-snug text-ink-3 sm:block">
                        最新メール取り込み：{jst(s?.lastImportAt)}
                        <br />
                        設定：{jst(s?.enabledAt ?? s?.verifiedAt)}
                        {s?.lastKind ? <>（最後：{MAIL_KIND_LABEL[s.lastKind]}）</> : null}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-wisteria" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {/* 設定手順のダイアログ */}
        <Dialog open={!!openSite} onClose={() => setOpenSite(null)} title={openSite ? `${openSite.name} の設定` : ''}>
          {openSite && address && (
            <div className="space-y-4 p-5">
              <p className="text-[17px] font-bold text-navy">{openSite.name}</p>
              <ol className="space-y-3 text-sm leading-relaxed text-ink-2">
                <li className="rounded-xl border border-line p-3">
                  <p className="font-bold text-navy">1. 取り込み専用アドレスをコピー</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="select-all rounded-lg bg-lilac px-3 py-2 font-mono text-[13px] text-navy">{address}</code>
                    <Button size="sm" variant="secondary" onClick={copy}>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      コピー
                    </Button>
                  </div>
                </li>
                <li className="rounded-xl border border-line p-3">
                  <p className="font-bold text-navy">2. {openSite.name} の店舗管理画面で、予約通知メールの送り先に登録</p>
                  <p className="mt-1">{openSite.howTo}</p>
                  {openSite.adminUrl && (
                    <a
                      href={openSite.adminUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-royal px-3 py-2 text-[13px] font-bold text-white hover:bg-plum"
                    >
                      <ExternalLink className="h-4 w-4" />
                      {openSite.name} の店舗管理画面を開く
                    </a>
                  )}
                </li>
                <li className="rounded-xl border border-line p-3">
                  <p className="font-bold text-navy">3. 登録できたら印を付ける</p>
                  <p className="mt-1">サイトから最初のメール（確認メールか予約メール）が届いた時点で「設定済」に変わります。届かないときは、登録したアドレスを見直してください。</p>
                  <div className="mt-2 flex gap-2">
                    {siteStatus(settings, openSite.key) === 'off' ? (
                      <Button onClick={() => mark(openSite.key, true)} disabled={pending}>
                        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        登録した
                      </Button>
                    ) : (
                      <Button variant="secondary" onClick={() => mark(openSite.key, false)} disabled={pending}>
                        印を外す
                      </Button>
                    )}
                  </div>
                </li>
              </ol>
              <div className="flex justify-end">
                <Button variant="ghost" onClick={() => setOpenSite(null)}>閉じる</Button>
              </div>
            </div>
          )}
        </Dialog>
      </CardContent>
    </Card>
  );
}
