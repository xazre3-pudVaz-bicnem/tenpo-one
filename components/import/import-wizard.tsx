'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Upload,
  Download,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { FIELD_DEFS, IMPORT_TYPE_LABELS, IMPORT_TYPE_LIST_PATH } from './field-defs';
import { buildTemplateDataUri } from './template';
import { CsvEncodingError, MAX_IMPORT_ROWS, decodeCsvFile, parseCsv } from './csv-parser';
import { autoDetectMapping } from './mapping';
import { applyExistingDuplicates, buildParsedRows, validateRowsLocally } from './preview';
import { checkExistingDuplicates, importRows } from '@/app/app/settings/import/actions';
import type { ImportResult, ImportRowInput, ImportType, ParsedRow, RowIssue } from './types';

const IMPORT_TYPES: ImportType[] = ['menu_items', 'customers', 'vendors', 'inventory_items'];

function needsStore(type: ImportType): boolean {
  return type === 'menu_items' || type === 'inventory_items';
}

type Step = 'upload' | 'mapping' | 'preview' | 'result';

export function ImportWizard({
  targetStoreName,
  hasStore,
}: {
  targetStoreName: string | null;
  hasStore: boolean;
}) {
  const { toast } = useToast();
  const [importType, setImportType] = useState<ImportType>('menu_items');
  const [step, setStep] = useState<Step>('upload');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [mapping, setMapping] = useState<Record<string, number | null>>({});

  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [issues, setIssues] = useState<RowIssue[]>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);

  const [result, setResult] = useState<ImportResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const fields = FIELD_DEFS[importType];

  function resetToUpload(nextType?: ImportType) {
    if (nextType) setImportType(nextType);
    setStep('upload');
    setFileName(null);
    setHeaders([]);
    setDataRows([]);
    setUploadError(null);
    setMapping({});
    setParsedRows([]);
    setIssues([]);
    setResult(null);
    setResultError(null);
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
      const nonEmptyBody = body.filter((r) => r.some((c) => c.trim() !== ''));
      if (nonEmptyBody.length === 0) {
        setUploadError('データ行がありません（ヘッダー行のみのファイルです）');
        return;
      }
      if (nonEmptyBody.length > MAX_IMPORT_ROWS) {
        setUploadError(
          `一度にインポートできるのは${MAX_IMPORT_ROWS}行までです（このファイルは${nonEmptyBody.length}行）。ファイルを分割してアップロードしてください`
        );
        return;
      }
      setFileName(file.name);
      setHeaders(headerRow);
      setDataRows(nonEmptyBody);
      setMapping(autoDetectMapping(headerRow, FIELD_DEFS[importType]));
      setStep('mapping');
    } catch (err) {
      if (err instanceof CsvEncodingError) setUploadError(err.message);
      else setUploadError('ファイルの読み込みに失敗しました');
    }
  }

  const requiredMissing = useMemo(
    () => fields.filter((f) => f.required && mapping[f.key] == null),
    [fields, mapping]
  );

  async function handleProceedToPreview() {
    const parsed = buildParsedRows(dataRows, mapping, fields);
    const { issues: localIssues, dupKeysToCheck } = validateRowsLocally(importType, parsed);
    setParsedRows(parsed);
    setIssues(localIssues);
    setStep('preview');

    if (dupKeysToCheck.length === 0) return;
    setCheckingDuplicates(true);
    try {
      const existing = await checkExistingDuplicates(importType, dupKeysToCheck);
      setIssues((prev) => applyExistingDuplicates(prev, new Set(existing)));
    } catch (err) {
      toast(err instanceof Error ? err.message : '重複確認に失敗しました', 'error');
    } finally {
      setCheckingDuplicates(false);
    }
  }

  const issueByRow = useMemo(() => new Map(issues.map((i) => [i.rowNumber, i])), [issues]);
  const validCount = issues.filter((i) => i.status === 'ok').length;
  const errorCount = issues.filter((i) => i.status === 'error').length;
  const duplicateCount = issues.filter((i) => i.status === 'duplicate').length;

  function handleExecute() {
    const payload: ImportRowInput[] = parsedRows
      .filter((row) => issueByRow.get(row.rowNumber)?.status === 'ok')
      .map((row) => ({ rowNumber: row.rowNumber, values: row.values }));

    setResultError(null);
    startTransition(async () => {
      try {
        const res = await importRows(importType, payload);
        setResult(res);
        setStep('result');
      } catch (err) {
        setResultError(err instanceof Error ? err.message : '登録に失敗しました');
      }
    });
  }

  const storeBlocked = needsStore(importType) && !hasStore;

  return (
    <div className="space-y-5">
      {/* 種別選択 */}
      <div>
        <div className="flex flex-wrap gap-2">
          {IMPORT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => t !== importType && resetToUpload(t)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                t === importType ? 'bg-navy text-white' : 'bg-white text-navy border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {IMPORT_TYPE_LABELS[t]}
            </button>
          ))}
          <span
            className="cursor-not-allowed rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-400"
            title="スタッフはスタッフ管理画面の招待機能をご利用ください"
          >
            スタッフ（対象外）
          </span>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          ※ スタッフはアカウント作成が必要なため、このCSV取込の対象外です。スタッフ管理画面の招待機能をご利用ください。
        </p>
      </div>

      {storeBlocked ? (
        <EmptyState
          title="対象店舗が選択されていません"
          description="この種別を取り込むには店舗の選択が必要です。画面上部で店舗を選択してから再度お試しください"
        />
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{IMPORT_TYPE_LABELS[importType]}の取込</CardTitle>
            {needsStore(importType) && targetStoreName && (
              <span className="text-xs text-gray-500">対象店舗: {targetStoreName}</span>
            )}
          </CardHeader>
          <CardContent>
            <Steps step={step} />

            {step === 'upload' && (
              <UploadStep
                importType={importType}
                uploadError={uploadError}
                fileInputRef={fileInputRef}
                onFile={handleFile}
              />
            )}

            {step === 'mapping' && (
              <MappingStep
                fields={fields}
                headers={headers}
                mapping={mapping}
                fileName={fileName}
                rowCount={dataRows.length}
                requiredMissing={requiredMissing}
                onChangeMapping={(key, value) => setMapping((m) => ({ ...m, [key]: value }))}
                onBack={() => setStep('upload')}
                onNext={handleProceedToPreview}
              />
            )}

            {step === 'preview' && (
              <PreviewStep
                fields={fields}
                parsedRows={parsedRows}
                issueByRow={issueByRow}
                checkingDuplicates={checkingDuplicates}
                validCount={validCount}
                errorCount={errorCount}
                duplicateCount={duplicateCount}
                pending={pending}
                resultError={resultError}
                onBack={() => setStep('mapping')}
                onExecute={handleExecute}
              />
            )}

            {step === 'result' && result && (
              <ResultStep importType={importType} result={result} onReset={() => resetToUpload()} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const items: { key: Step; label: string }[] = [
    { key: 'upload', label: '1. アップロード' },
    { key: 'mapping', label: '2. 項目の対応付け' },
    { key: 'preview', label: '3. 確認' },
    { key: 'result', label: '4. 完了' },
  ];
  const currentIndex = items.findIndex((i) => i.key === step);
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {items.map((item, idx) => (
        <li
          key={item.key}
          className={`rounded-full px-3 py-1 font-medium ${
            idx === currentIndex
              ? 'bg-primary-soft text-primary-deep'
              : idx < currentIndex
                ? 'text-success'
                : 'text-gray-400'
          }`}
        >
          {item.label}
        </li>
      ))}
    </ol>
  );
}

function UploadStep({
  importType,
  uploadError,
  fileInputRef,
  onFile,
}: {
  importType: ImportType;
  uploadError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={buildTemplateDataUri(importType)}
          download={`tenpoone_${importType}_template.csv`}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary-deep hover:underline"
        >
          <Download className="h-4 w-4" />
          {IMPORT_TYPE_LABELS[importType]}のテンプレートCSVをダウンロード
        </a>
      </div>

      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center">
        <Upload className="mx-auto mb-3 h-8 w-8 text-gray-400" />
        <p className="mb-3 text-sm text-gray-600">CSVファイルを選択してください（UTF-8）</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
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
  );
}

function MappingStep({
  fields,
  headers,
  mapping,
  fileName,
  rowCount,
  requiredMissing,
  onChangeMapping,
  onBack,
  onNext,
}: {
  fields: (typeof FIELD_DEFS)[ImportType];
  headers: string[];
  mapping: Record<string, number | null>;
  fileName: string | null;
  rowCount: number;
  requiredMissing: (typeof FIELD_DEFS)[ImportType];
  onChangeMapping: (key: string, value: number | null) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">
        {fileName ? `${fileName}（${rowCount}行）` : ''} の列を、取込項目に対応付けてください。列名から自動推定しています。
      </p>

      <div className="space-y-4">
        {fields.map((field) => (
          <div key={field.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[200px_1fr] sm:items-start">
            <div>
              <Label>
                {field.label}
                {field.required && <span className="ml-1 text-danger">*</span>}
              </Label>
              {field.hint && <p className="text-xs text-gray-500">{field.hint}</p>}
            </div>
            <Select
              value={mapping[field.key] ?? ''}
              onChange={(e) => onChangeMapping(field.key, e.target.value === '' ? null : Number(e.target.value))}
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

      {requiredMissing.length > 0 && (
        <p className="text-xs text-danger">
          必須項目が対応付けられていません: {requiredMissing.map((f) => f.label).join('、')}
        </p>
      )}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="secondary" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> 戻る
        </Button>
        <Button type="button" onClick={onNext} disabled={requiredMissing.length > 0}>
          確認へ進む <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<RowIssue['status'], string> = { ok: 'OK', error: 'エラー', duplicate: '重複' };

function PreviewStep({
  fields,
  parsedRows,
  issueByRow,
  checkingDuplicates,
  validCount,
  errorCount,
  duplicateCount,
  pending,
  resultError,
  onBack,
  onExecute,
}: {
  fields: (typeof FIELD_DEFS)[ImportType];
  parsedRows: ParsedRow[];
  issueByRow: Map<number, RowIssue>;
  checkingDuplicates: boolean;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  pending: boolean;
  resultError: string | null;
  onBack: () => void;
  onExecute: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Badge tone="success">登録対象 {validCount}件</Badge>
        <Badge tone="danger">エラー {errorCount}件</Badge>
        <Badge tone="warning">重複（スキップ） {duplicateCount}件</Badge>
        {checkingDuplicates && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 登録済みデータとの重複を確認中…
          </span>
        )}
      </div>

      <TableWrap>
        <Table>
          <THead>
            <Tr>
              <Th>行</Th>
              {fields.map((f) => (
                <Th key={f.key}>{f.label}</Th>
              ))}
              <Th>状態</Th>
            </Tr>
          </THead>
          <TBody>
            {parsedRows.map((row) => {
              const issue = issueByRow.get(row.rowNumber);
              return (
                <Tr key={row.rowNumber}>
                  <Td>{row.rowNumber}</Td>
                  {fields.map((f) => (
                    <Td key={f.key} className="max-w-[220px] truncate">
                      {row.values[f.key] || <span className="text-gray-300">—</span>}
                    </Td>
                  ))}
                  <Td>
                    {issue?.status === 'ok' && <Badge tone="success">OK</Badge>}
                    {issue?.status === 'error' && (
                      <span className="inline-flex items-center gap-1">
                        <Badge tone="danger">{STATUS_LABEL.error}</Badge>
                        <span className="text-xs text-danger">{issue.reason}</span>
                      </span>
                    )}
                    {issue?.status === 'duplicate' && (
                      <span className="inline-flex items-center gap-1">
                        <Badge tone="warning">{STATUS_LABEL.duplicate}</Badge>
                        <span className="text-xs text-gray-500">{issue.reason}</span>
                      </span>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </TableWrap>

      {resultError && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{resultError}</span>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="secondary" onClick={onBack} disabled={pending}>
          <ArrowLeft className="h-4 w-4" /> 戻る
        </Button>
        <Button type="button" onClick={onExecute} disabled={validCount === 0 || pending || checkingDuplicates}>
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> 登録中…
            </>
          ) : (
            `${validCount}件を登録する`
          )}
        </Button>
      </div>
    </div>
  );
}

function ResultStep({
  importType,
  result,
  onReset,
}: {
  importType: ImportType;
  result: ImportResult;
  onReset: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success-soft px-5 py-4">
        <CheckCircle2 className="h-6 w-6 shrink-0 text-success" />
        <div className="text-sm">
          <p className="font-semibold text-navy">取込が完了しました</p>
          <p className="mt-1 text-gray-600">
            登録 {result.inserted}件 / スキップ（重複） {result.skipped}件
            {result.failed.length > 0 && ` / 失敗 ${result.failed.length}件`}
          </p>
        </div>
      </div>

      {result.failed.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-danger">失敗した行</p>
          <ul className="space-y-1 text-xs text-gray-600">
            {result.failed.map((f) => (
              <li key={f.rowNumber}>
                {f.rowNumber}行目: {f.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <Link href={IMPORT_TYPE_LIST_PATH[importType]}>
          <Button type="button">{IMPORT_TYPE_LABELS[importType]}の一覧を見る</Button>
        </Link>
        <Button type="button" variant="secondary" onClick={onReset}>
          <RotateCcw className="h-4 w-4" /> 続けて取り込む
        </Button>
      </div>
    </div>
  );
}
