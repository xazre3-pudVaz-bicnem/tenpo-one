'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea, Label } from '@/components/ui/input';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { yen, formatDateTime } from '@/lib/format';
import { getDailyReportDetail, submitDailyReport, approveDailyReport, type DailyReportDetail } from './actions';

const STATUS_LABEL: Record<string, string> = { draft: '下書き', submitted: '提出済み', approved: '承認済み' };
const STATUS_TONE: Record<string, BadgeTone> = { draft: 'gray', submitted: 'warning', approved: 'success' };

export function ReportDetailDialog({
  reportId,
  canSubmit,
  canApprove,
  triggerLabel = '詳細を見る',
}: {
  reportId: string;
  canSubmit: boolean;
  canApprove: boolean;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<DailyReportDetail | null>(null);
  const [comment, setComment] = useState('');
  const router = useRouter();
  const { toast } = useToast();

  const load = async () => {
    setOpen(true);
    setLoading(true);
    try {
      const d = await getDailyReportDetail(reportId);
      setDetail(d);
      setComment(d.comment ?? '');
    } catch (e) {
      toast(e instanceof Error ? e.message : '読み込みに失敗しました', 'error');
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await submitDailyReport(detail.id, comment);
      toast('日報を提出しました');
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : '提出に失敗しました', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await approveDailyReport(detail.id);
      toast('日報を承認しました');
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : '承認に失敗しました', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => void load()}>
        <Eye className="h-3.5 w-3.5" />
        {triggerLabel}
      </Button>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} title="日報詳細">
        {loading || !detail ? (
          <p className="py-8 text-center text-sm text-gray-400">読み込み中…</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-navy">
                  {detail.storeName}　{detail.businessDate.replaceAll('-', '/')}
                </p>
                {detail.submittedAt && <p className="text-xs text-gray-500">提出: {formatDateTime(detail.submittedAt)}</p>}
                {detail.approvedAt && <p className="text-xs text-gray-500">承認: {formatDateTime(detail.approvedAt)}</p>}
              </div>
              <Badge tone={STATUS_TONE[detail.status] ?? 'gray'}>{STATUS_LABEL[detail.status] ?? detail.status}</Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-sm sm:grid-cols-4">
              <Metric label="売上" value={yen(detail.metrics.sales)} />
              <Metric label="客数" value={`${detail.metrics.guests}名`} />
              <Metric label="客単価" value={yen(detail.metrics.avgSpend)} />
              <Metric
                label="現金差異"
                value={detail.metrics.cashDifference == null ? '未締め' : yen(detail.metrics.cashDifference)}
              />
              <Metric label="予約数" value={`${detail.metrics.reservationsCount}件`} />
              <Metric label="キャンセル数" value={`${detail.metrics.cancelCount}件`} />
              <Metric label="廃棄額" value={yen(detail.metrics.wasteAmount)} />
              <Metric label="人件費概算" value={yen(detail.metrics.laborCost)} />
            </div>

            {detail.status === 'draft' && canSubmit ? (
              <div>
                <Label htmlFor="dr-comment">コメント</Label>
                <Textarea id="dr-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="申し送り事項・特記事項を入力" />
              </div>
            ) : (
              detail.comment && (
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-500">コメント</p>
                  <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{detail.comment}</p>
                </div>
              )
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
                閉じる
              </Button>
              {detail.status === 'draft' && canSubmit && (
                <Button onClick={() => void handleSubmit()} disabled={busy}>
                  {busy ? '送信中…' : '提出する'}
                </Button>
              )}
              {detail.status === 'submitted' && canApprove && (
                <Button variant="success" onClick={() => void handleApprove()} disabled={busy}>
                  {busy ? '処理中…' : '承認する'}
                </Button>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-semibold tabular-nums text-navy">{value}</p>
    </div>
  );
}
