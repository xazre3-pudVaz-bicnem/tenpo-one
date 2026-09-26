'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { GOURMET_SITE_BY_KEY, MAIL_KIND_LABEL, type GourmetSiteKey, type MailKind } from '@/lib/gourmet-mail';
import { resolveGourmetMailImport } from '@/app/app/settings/reservation-book/actions';

export interface GourmetMailImportRow {
  id: string;
  site: GourmetSiteKey;
  kind: MailKind;
  status: string;
  subject: string | null;
  fromAddress: string | null;
  externalId: string | null;
  receivedAt: string;
  reservationId: string | null;
  error: string | null;
  resolvedAt: string | null;
  parsed: { date?: string | null; time?: string | null; partySize?: number | null; guestName?: string | null; phone?: string | null } | null;
  bodyText: string | null;
}

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  imported: { label: '台帳に登録', tone: 'success' },
  updated: { label: '変更を反映', tone: 'success' },
  cancelled: { label: 'キャンセル反映', tone: 'navy' },
  verified: { label: 'メール認証', tone: 'primary' },
  duplicate: { label: '重複（登録済）', tone: 'gray' },
  ignored: { label: '対象外', tone: 'gray' },
  needs_review: { label: '要確認', tone: 'danger' },
};

function jst(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

/** 取り込んだメールの一覧。「要確認」は店舗が中身を見て台帳に手で入れ、対応済みにする */
export function GourmetMailImports({ storeId, rows }: { storeId: string; rows: GourmetMailImportRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);

  const resolve = (id: string) =>
    startTransition(async () => {
      const r = await resolveGourmetMailImport(storeId, id);
      if (r.error) return toast(r.error, 'error');
      toast('対応済みにしました');
      router.refresh();
    });

  const pendingReview = rows.filter((r) => r.status === 'needs_review' && !r.resolvedAt).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Inbox className="h-5 w-5 text-royal" aria-hidden />
          取り込み履歴
          <span className="en-inline text-xs">Imports</span>
          {pendingReview > 0 && <Badge tone="danger">要確認 {pendingReview}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-3">まだ取り込んだメールはありません。</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const st = STATUS[r.status] ?? { label: r.status, tone: 'gray' as BadgeTone };
              const site = GOURMET_SITE_BY_KEY[r.site]?.name ?? r.site;
              const open = openId === r.id;
              const review = r.status === 'needs_review' && !r.resolvedAt;
              const p = r.parsed ?? {};
              return (
                <li key={r.id} className="py-2">
                  <button type="button" onClick={() => setOpenId(open ? null : r.id)} className="flex w-full items-center gap-2 text-left">
                    <span className="w-[74px] shrink-0 text-[12px] tabular-nums text-ink-3">{jst(r.receivedAt)}</span>
                    <span className="w-[110px] shrink-0 truncate text-[13px] font-bold text-navy">{site}</span>
                    <span className="w-[72px] shrink-0 text-[12px] text-ink-2">{MAIL_KIND_LABEL[r.kind]}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
                      {p.date ? `${p.date} ${p.time ?? ''} ${p.partySize ?? '?'}名 ${p.guestName ?? ''}` : (r.subject ?? '')}
                    </span>
                    <Badge tone={review ? 'danger' : r.resolvedAt ? 'gray' : st.tone}>{r.resolvedAt ? '対応済み' : st.label}</Badge>
                    <ChevronDown className={cn('h-4 w-4 shrink-0 text-wisteria transition-transform', open && 'rotate-180')} aria-hidden />
                  </button>
                  {open && (
                    <div className="mt-2 rounded-xl border border-line bg-lilac-soft/50 p-3 text-[13px] text-ink-2">
                      <p><b>件名：</b>{r.subject ?? '—'}</p>
                      <p><b>差出人：</b>{r.fromAddress ?? '—'}</p>
                      {r.externalId && <p><b>予約番号：</b>{r.externalId}</p>}
                      {r.error && <p className="text-danger"><b>理由：</b>{r.error}</p>}
                      {r.bodyText && (
                        <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-white p-2 text-[12px] whitespace-pre-wrap text-navy">{r.bodyText.slice(0, 3000)}</pre>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {r.reservationId && (
                          <a href={`/app/reservations?open=${r.reservationId}`} className="inline-flex h-9 items-center rounded-lg border border-line bg-white px-3 text-[13px] font-bold text-royal">
                            台帳で見る
                          </a>
                        )}
                        {review && (
                          <>
                            <a href="/app/reservations" className="inline-flex h-9 items-center rounded-lg bg-royal px-3 text-[13px] font-bold text-white">
                              台帳に手で入れる
                            </a>
                            <Button size="sm" variant="secondary" onClick={() => resolve(r.id)} disabled={pending}>
                              <Check className="h-4 w-4" />
                              対応済みにする
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
