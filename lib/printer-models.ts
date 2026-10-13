/**
 * iPad と Bluetooth でつなぐレシートプリンターの機種（Airレジのように「プリンター」を選ぶ）。
 * 2026-10-14 Ronnie「プリンター選択がいる。日本で人気の Bluetooth のプリンターを全部（Star・EPSON・Brother など）」
 *
 * ready=true … TENPO ONE レジ アプリから今すぐ使える
 *   Star・EPSON：iPad の 設定 > Bluetooth でペアリング → アプリが External Accessory（MFi）でそのまま送る（SDK なし）
 *   その他の ESC/POS：Bluetooth LE（ペアリング不要）
 * ready=false … 一覧には出すが選べない（メーカーの接続の許可（MFi）や専用の命令が要る。届きしだい使えるようにする）
 */
export type PrinterModelMaker = 'star' | 'epson' | 'sii' | 'citizen' | 'brother' | 'escpos';

export interface PrinterModel {
  id: string;
  maker: PrinterModelMaker;
  name: string;
  /** 紙の幅（mm） */
  paper: 58 | 80;
  /** キャッシュドロアをつなげる */
  drawer: boolean;
  /** 持ち歩く小さいプリンター */
  mobile?: boolean;
  ready: boolean;
}

export const PRINTER_MAKER_LABEL: Record<PrinterModelMaker, string> = {
  star: 'Star（スター精密）',
  epson: 'EPSON（エプソン）',
  sii: 'SII（セイコーインスツル）',
  citizen: 'Citizen（シチズン）',
  brother: 'Brother（ブラザー）',
  escpos: 'その他',
};

export const PRINTER_MODELS: readonly PrinterModel[] = [
  // Star（Bluetooth・MFi。StarPRNT）
  { id: 'star-mcp31', maker: 'star', name: 'mC-Print3', paper: 80, drawer: true, ready: true },
  { id: 'star-mcp21', maker: 'star', name: 'mC-Print2', paper: 58, drawer: true, ready: true },
  { id: 'star-mpop', maker: 'star', name: 'mPOP', paper: 58, drawer: true, ready: true },
  { id: 'star-tsp100iii-bi', maker: 'star', name: 'TSP100IIIBI', paper: 80, drawer: true, ready: true },
  { id: 'star-sm-s210i', maker: 'star', name: 'SM-S210i', paper: 58, drawer: false, mobile: true, ready: true },
  { id: 'star-sm-l200', maker: 'star', name: 'SM-L200', paper: 58, drawer: false, mobile: true, ready: true },
  // EPSON（Bluetooth・MFi。ESC/POS）
  { id: 'epson-tm-m30iii', maker: 'epson', name: 'TM-m30III', paper: 80, drawer: true, ready: true },
  { id: 'epson-tm-m30ii', maker: 'epson', name: 'TM-m30II', paper: 80, drawer: true, ready: true },
  { id: 'epson-tm-m10', maker: 'epson', name: 'TM-m10', paper: 58, drawer: true, ready: true },
  { id: 'epson-tm-p20ii', maker: 'epson', name: 'TM-P20II', paper: 58, drawer: false, mobile: true, ready: true },
  { id: 'epson-tm-p80ii', maker: 'epson', name: 'TM-P80II', paper: 80, drawer: false, mobile: true, ready: true },
  // 準備中（メーカーの接続の許可・専用の命令が要る）
  { id: 'sii-rp-f10', maker: 'sii', name: 'RP-F10', paper: 80, drawer: true, ready: false },
  { id: 'sii-mp-b20', maker: 'sii', name: 'MP-B20', paper: 58, drawer: false, mobile: true, ready: false },
  { id: 'citizen-ct-s751', maker: 'citizen', name: 'CT-S751', paper: 80, drawer: true, ready: false },
  { id: 'citizen-cmp-30ii', maker: 'citizen', name: 'CMP-30II', paper: 80, drawer: false, mobile: true, ready: false },
  { id: 'brother-rj-4250wb', maker: 'brother', name: 'RJ-4250WB', paper: 80, drawer: false, mobile: true, ready: false },
  { id: 'brother-td-4550dnwb', maker: 'brother', name: 'TD-4550DNWB', paper: 80, drawer: false, ready: false },
  // そのほか（Bluetooth LE の ESC/POS プリンター）
  { id: 'escpos-ble-80', maker: 'escpos', name: 'そのほかの ESC/POS（80mm）', paper: 80, drawer: true, ready: true },
  { id: 'escpos-ble-58', maker: 'escpos', name: 'そのほかの ESC/POS（58mm）', paper: 58, drawer: false, ready: true },
];

export const PRINTER_MAKER_ORDER: readonly PrinterModelMaker[] = ['star', 'epson', 'sii', 'citizen', 'brother', 'escpos'];

export function printerModelById(id: string | null | undefined): PrinterModel | null {
  return PRINTER_MODELS.find((m) => m.id === id) ?? null;
}

/** 保存してある機種名から機種を当てる（無ければ null） */
export function printerModelOf(model: string | null | undefined): PrinterModel | null {
  const name = (model ?? '').trim().toLowerCase();
  if (name) {
    const hit = PRINTER_MODELS.find((m) => m.name.toLowerCase() === name);
    if (hit) return hit;
  }
  return null;
}

/** アプリに「探す」を頼むときの種類（Star・EPSON はペアリング済みの MFi、その他は Bluetooth LE） */
export function discoverKindOf(m: PrinterModel): 'star' | 'epson' | 'all' {
  if (m.maker === 'star') return 'star';
  if (m.maker === 'epson') return 'epson';
  return 'all';
}

/** 見つかった機械がこの機種のメーカーのものか */
export function deviceMatchesModel(m: PrinterModel, device: { maker: string }): boolean {
  if (m.maker === 'star') return device.maker === 'star';
  if (m.maker === 'epson') return device.maker === 'epson';
  return device.maker === 'escpos' || device.maker === 'sii';
}

/** 送るデータの種類（Star＝StarPRNT、そのほか＝ESC/POS）。printer_configs.maker に入れる言い方 */
export function makerSettingOf(m: PrinterModel): 'Star' | 'EPSON' | 'その他' {
  if (m.maker === 'star') return 'Star';
  if (m.maker === 'epson') return 'EPSON';
  return 'その他';
}
