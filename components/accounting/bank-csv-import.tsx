'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { Upload, ArrowLeft, ArrowRight, AlertTriangle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { yen, formatDate } from '@/lib/format';
import { CsvEncodingError, MAX_IMPORT_ROWS, decodeCsvFile, parseCsv } from '@/components/import/csv-parser';
import {
  checkBankCsvDuplicates,
  importBankTransactionsCsv,
  type BankCsvRow,
  type ImportCsvSummary,
} from '@/app/app/accounting/banks/actions';

type Step = 'upload' | 'mapping' | 'preview' | 'result';

interface ColumnMapping {
  date: number | null;
  description: number | null;
  deposit: number | null;
  withdrawal: number | null;
}

interface PreviewRow {
  rowNumber: number;
  raw: string[];
  parsed: BankCsvRow | null;
  error: string | null;
  /** 完全一致（自動スキップ対象） */
  exactDuplicate: boolean;
  /** 疑わしい重複（同一日付+同一金額・摘要が異なる既存行あり。取込/スキップを選択可能） */
  suspiciousDuplicate: boolean;
  suspiciousDescriptions: string[];
  /** 疑わしい重複行のみ利用者が切り替え可能（既定=取り込む） */
  include: boolean;
}

/** 日付表記のゆらぎ（区切り文字違い）を吸収して 'YYYY-MM-DD' へ正規化する */
function normalizeDate(raw: string): string | null {
  const s = raw.trim().replace(/[／．]/g, '/').replace(/[.]/g, '-').replace(/\//g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const y = m[1];
  const mo = m[2].padStart(2, '0');
  const d = m[3].padStart(2, '0');
  const iso = `${y}-${mo}-${d}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return iso;
}

/** 金額表記（カンマ・円記号）を除去して整数化する */
function normalizeAmount(raw: string): number {
  const cleaned = raw.replace(/[¥,円\s]/g, '').trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(Math.abs(n)) : NaN;
}

export function BankCsvImport({ bankAccountId }: { bankAccountId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({ date: null, description: null, deposit: null, withdrawal: null });
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [checkingDup, setCheckingDup] = useState(false);
  const [result, setResult] = useState<ImportCsvSummary | null>(null);
  const [pending, startTransition] = useTransition();

  function resetAll() {
    setStep('upload');
    setFileName(null);
    setHeaders([]);
    setDataRows([]);
    setUploadError(null);
    setMapping({ date: null, description: null, deposit: null, withdrawal: null });
    setPreviewRows([]);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleFile(file: File) {
    setUploadError(null);
    try {
      const text = await decodeCsvFile(file);
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setUploadError('空のファイルです');
        return;
      }
      const [headerRow, ...body] = rows;
      const nonEmpty = body.filter((r) => r.some((c) => c.trim() !== ''));
      if (nonEmpty.length === 0) {
        setUploadError('データ行がありません（ヘッダー行のみのファイルです）');
        return;
      }
      if (nonEmpty.length > MAX_IMPORT_ROWS) {
        setUploadError(`一度に取込できるのは${MAX_IMPORT_ROWS}行までです（このファイルは${nonEmpty.length}行）`);
        return;
      }
      setFileName(file.name);
      setHeaders(headerRow);
      setDataRows(nonEmpty);
      // 列名からの簡易自動推定
      const findCol = (keywords: string[]) => headerRow.findIndex((h) => keywords.some((k) => h.includes(k)));
      setMapping({
        date: ((): number | null => { const i = findCol(['日付', '年月日', 'date']); return i >= 0 ? i : null; })(),
        description: ((): number | null => { const i = findCol(['摘要', '内容', '取引内容', 'description']); return i >= 0 ? i : null; })(),
        deposit: ((): number | null => { const i = findCol(['入金', 'お預け入れ', 'deposit']); return i >= 0 ? i : null; })(),
        withdrawal: ((): number | null => { const i = findCol(['出金', 'お引き出し', 'withdrawal']); return i >= 0 ? i : null; })(),
      });
      setStep('mapping');
    } catch (err) {
      setUploadError(err instanceof CsvEncodingError ? err.message : 'ファイルの読み込みに失敗しました');
    }
  }

  const mappingComplete = mapping.date != null && mapping.description != null && (mapping.deposit != null || mapping.withdrawal != null);

  async function handleProceedToPreview() {
    const rows: PreviewRow[] = dataRows.map((cells, i): PreviewRow => {
      const rowNumber = i + 1;
      const dateRaw = mapping.date != null ? cells[mapping.date] ?? '' : '';
      const descRaw = mapping.description != null ? cells[mapping.description] ?? '' : '';
      const depositRaw = mapping.deposit != null ? cells[mapping.deposit] ?? '' : '';
      const withdrawalRaw = mapping.withdrawal != null ? cells[mapping.withdrawal] ?? '' : '';

      const date = normalizeDate(dateRaw);
      const deposit = normalizeAmount(depositRaw);
      const withdrawal = normalizeAmount(withdrawalRaw);

      const base = {
        rowNumber,
        raw: cells,
        exactDuplicate: false,
        suspiciousDuplicate: false,
        suspiciousDescriptions: [] as string[],
        include: true,
      };
      if (!date) return { ...base, parsed: null, error: `日付を解釈できません（${dateRaw}）` };
      if (!descRaw.trim()) return { ...base, parsed: null, error: '摘要が空です' };
      if (Number.isNaN(deposit) || Number.isNaN(withdrawal)) {
        return { ...base, parsed: null, error: '金額を解釈できません' };
      }
      if (deposit === 0 && withdrawal === 0) return { ...base, parsed: null, error: '入金・出金がいずれも0円です' };
      if (deposit > 0 && withdrawal > 0) return { ...base, parsed: null, error: '入金・出金が両方入力されています' };

      return { ...base, parsed: { date, description: descRaw.trim(), deposit, withdrawal }, error: null };
    });
    setPreviewRows(rows);
    setStep('preview');

    const validRows = rows.filter((r) => r.parsed);
    if (validRows.length === 0) return;
    setCheckingDup(true);
    try {
      const flags = await checkBankCsvDuplicates(bankAccountId, validRows.map((r) => r.parsed as BankCsvRow));
      let idx = 0;
      setPreviewRows((prev) =>
        prev.map((r) => {
          if (!r.parsed) return r;
          const flag = flags[idx];
          idx += 1;
          return {
            ...r,
            exactDuplicate: flag.exactDuplicate,
            suspiciousDuplicate: flag.suspiciousDuplicate,
            suspiciousDescriptions: flag.suspiciousDescriptions,
            // 疑わしい重複は既定で取込済み（利用者が明示的にスキップへ切替できる）
            include: true,
          };
        })
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : '重複確認に失敗しました', 'error');
    } finally {
      setCheckingDup(false);
    }
  }

  const newRows = previewRows.filter((r) => r.parsed && !r.exactDuplicate && !r.suspiciousDuplicate);
  const suspiciousRows = previewRows.filter((r) => r.parsed && r.suspiciousDuplicate);
  const suspiciousIncludedRows = suspiciousRows.filter((r) => r.include);
  const errorCount = previewRows.filter((r) => !r.parsed).length;
  const exactDuplicateCount = previewRows.filter((r) => r.exactDuplicate).length;
  const importable = [...newRows, ...suspiciousIncludedRows];

  function toggleInclude(rowNumber: number) {
    setPreviewRows((prev) => prev.map((r) => (r.rowNumber === rowNumber ? { ...r, include: !r.include } : r)));
  }

  function handleImport() {
    const rows = [
      ...newRows.map((r) => ({ ...(r.parsed as BankCsvRow), category: 'new' as const })),
      ...suspiciousIncludedRows.map((r) => ({ ...(r.parsed as BankCsvRow), category: 'suspicious' as const })),
    ];
    startTransition(async () => {
      try {
        const res = await importBankTransactionsCsv(bankAccountId, rows);
        setResult(res);
        setStep('result');
        router.refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : '取込に失敗しました', 'error');
      }
    });
  }

  const fields: { key: keyof ColumnMapping; label: string; required: boolean }[] = useMemo(
    () => [
      { key: 'date', label: '日付', required: true },
      { key: 'description', label: '摘要', required: true },
      { key: 'deposit', label: '入金', required: false },
      { key: 'withdrawal', label: '出金', required: false },
    ],
    []
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>CSV取込</CardTitle>
      </CardHeader>
      <CardContent>
        {step === 'upload' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center">
              <Upload className="mx-auto mb-3 h-8 w-8 text-gray-400" />
              <p className="mb-3 text-sm text-gray-600">銀行明細のCSVファイルを選択してください（UTF-8）</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
              <Button type="button" onClick={() => fileInputRef.current?.click()}>
                ファイルを選択
              </Button>
            </div>
            {uploadError && (
              <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{uploadError}</span>
              </div>
            )}
          </div>
        )}

        {step === 'mapping' && (
          <div className="space-y-5">
            <p className="text-sm text-gray-600">
              {fileName}（{dataRows.length}行）の列を対応付けてください。日付・摘要は必須、入金・出金は少なくとも一方が必要です。
            </p>
            <div className="space-y-4">
              {fields.map((f) => (
                <div key={f.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr] sm:items-center">
                  <Label>
                    {f.label}
                    {f.required && <span className="ml-1 text-danger">*</span>}
                  </Label>
                  <Select
                    value={mapping[f.key] ?? ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value === '' ? null : Number(e.target.value) }))}
                  >
                    <option value="">（使用しない）</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `（${i + 1}列目）`}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-2">
              <Button type="button" variant="secondary" onClick={resetAll}>
                <ArrowLeft className="h-4 w-4" /> やり直す
              </Button>
              <Button type="button" onClick={handleProceedToPreview} disabled={!mappingComplete}>
                確認へ進む <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">新規 {newRows.length}件</Badge>
              <Badge tone="warning">要確認（疑わしい重複） {suspiciousRows.length}件</Badge>
              <Badge tone="gray">完全重複（自動スキップ） {exactDuplicateCount}件</Badge>
              <Badge tone="danger">エラー {errorCount}件</Badge>
              {checkingDup && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 重複を確認中…
                </span>
              )}
            </div>
            {suspiciousRows.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  同じ日付・同じ金額で摘要が異なる既存の取引があります。二重記帳の可能性があるため、行ごとに「取り込む/スキップ」を確認してください（既定は取り込む）。
                </span>
              </div>
            )}
            <TableWrap>
              <Table>
                <THead>
                  <Tr>
                    <Th>行</Th>
                    <Th>日付</Th>
                    <Th>摘要</Th>
                    <Th className="text-right">入金</Th>
                    <Th className="text-right">出金</Th>
                    <Th>状態</Th>
                    <Th>取込</Th>
                  </Tr>
                </THead>
                <TBody>
                  {previewRows.map((r) => (
                    <Tr key={r.rowNumber}>
                      <Td>{r.rowNumber}</Td>
                      <Td>{r.parsed ? formatDate(r.parsed.date) : '—'}</Td>
                      <Td className="max-w-[220px] truncate">{r.parsed?.description ?? '—'}</Td>
                      <Td className="text-right tabular-nums">{r.parsed && r.parsed.deposit > 0 ? yen(r.parsed.deposit) : '—'}</Td>
                      <Td className="text-right tabular-nums">{r.parsed && r.parsed.withdrawal > 0 ? yen(r.parsed.withdrawal) : '—'}</Td>
                      <Td>
                        {!r.parsed && (
                          <span className="inline-flex items-center gap-1">
                            <Badge tone="danger">エラー</Badge>
                            <span className="text-xs text-danger">{r.error}</span>
                          </span>
                        )}
                        {r.parsed && r.exactDuplicate && <Badge tone="gray">完全重複</Badge>}
                        {r.parsed && r.suspiciousDuplicate && (
                          <span className="inline-flex flex-col gap-0.5">
                            <Badge tone="warning">要確認</Badge>
                            <span className="text-[11px] text-gray-500">
                              類似取引: {r.suspiciousDescriptions.join('、')}
                            </span>
                          </span>
                        )}
                        {r.parsed && !r.exactDuplicate && !r.suspiciousDuplicate && <Badge tone="success">OK</Badge>}
                      </Td>
                      <Td>
                        {r.parsed && r.suspiciousDuplicate ? (
                          <Button type="button" size="sm" variant={r.include ? 'secondary' : 'danger'} onClick={() => toggleInclude(r.rowNumber)}>
                            {r.include ? '取り込む' : 'スキップ'}
                          </Button>
                        ) : r.parsed && !r.exactDuplicate ? (
                          <span className="text-xs text-gray-500">取込対象</span>
                        ) : r.parsed && r.exactDuplicate ? (
                          <span className="text-xs text-gray-400">自動スキップ</span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <div className="flex justify-between pt-2">
              <Button type="button" variant="secondary" onClick={() => setStep('mapping')} disabled={pending}>
                <ArrowLeft className="h-4 w-4" /> 戻る
              </Button>
              <Button type="button" onClick={handleImport} disabled={importable.length === 0 || pending || checkingDup}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {importable.length}件を取込む
              </Button>
            </div>
          </div>
        )}

        {step === 'result' && result && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success-soft px-5 py-4">
              <CheckCircle2 className="h-6 w-6 shrink-0 text-success" />
              <div className="text-sm">
                <p className="font-semibold text-navy">取込が完了しました</p>
                <p className="mt-1 text-gray-600">
                  新規 {result.newInserted}件 ・ 完全重複スキップ {result.exactDuplicateSkipped}件 ・ 要確認{' '}
                  {suspiciousRows.length}件のうち取込 {result.suspiciousInserted}件
                </p>
              </div>
            </div>
            <Button type="button" variant="secondary" onClick={resetAll}>
              <RotateCcw className="h-4 w-4" /> 続けて取り込む
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
