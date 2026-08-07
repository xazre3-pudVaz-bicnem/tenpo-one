/**
 * 書類OCR（自動読み取り）の受け皿。
 * 実OCRサービス未接続のため、ファイル名から日付らしき文字列を拾う程度の決定的モックのみを提供する。
 * 将来 DocumentExtractionProvider を実装したプロバイダに差し替えれば、呼び出し側（server action）の変更のみで済む。
 */

export interface DocumentExtractionLineItem {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
}

export interface DocumentExtraction {
  vendor: string | null;
  invoiceNumber: string | null;
  issuedDate: string | null; // 'YYYY-MM-DD'
  dueDate: string | null; // 'YYYY-MM-DD'
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  registrationNumber: string | null;
  lineItems: DocumentExtractionLineItem[];
  /** 0〜1。モックは常に低信頼度を返す */
  confidence: number;
}

export interface DocumentExtractionInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface DocumentExtractionProvider {
  readonly name: string;
  extract(input: DocumentExtractionInput): Promise<DocumentExtraction>;
}

/** OCRサービス未接続であることを示す注記（UI表示用） */
export const OCR_NOT_CONNECTED_NOTE = 'モック結果です。OCRサービス接続後に実データが入ります。';

const EMPTY_EXTRACTION: DocumentExtraction = {
  vendor: null,
  invoiceNumber: null,
  issuedDate: null,
  dueDate: null,
  subtotal: null,
  tax: null,
  total: null,
  registrationNumber: null,
  lineItems: [],
  confidence: 0.3,
};

/** ファイル名から 'YYYY-MM-DD' / 'YYYYMMDD' / 'YYYY_MM_DD' 等の日付らしき文字列を拾う（決定的・純関数） */
function extractDateFromFileName(fileName: string): string | null {
  const match = fileName.match(/(20\d{2})[-_./]?(\d{2})[-_./]?(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${m}-${d}`;
}

/**
 * OCR未接続時の決定的モック実装。
 * ファイル名から日付らしき文字列を拾うのみで、他の項目は常にnull・confidenceは0.3固定。
 */
export class MockOcrProvider implements DocumentExtractionProvider {
  readonly name = 'mock';

  async extract(input: DocumentExtractionInput): Promise<DocumentExtraction> {
    const issuedDate = extractDateFromFileName(input.fileName);
    return { ...EMPTY_EXTRACTION, issuedDate };
  }
}

export const mockOcrProvider: DocumentExtractionProvider = new MockOcrProvider();
