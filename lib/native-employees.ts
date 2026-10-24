import { isUuid } from '@/lib/native-pos';
import { isYmd } from '@/lib/native-shifts';
import type {
  CreateEmployeeInput,
  UpdateEmployeeBasicInput,
  UpdateEmployeeConfidentialInput,
  UpdateEmployeeInsuranceInput,
} from '@/app/app/employees/actions';

/**
 * iPad アプリのネイティブの「従業員台帳」（Web の /app/employees・/app/employees/[id] と同じ）。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」。
 *
 * 従業員の中身は個人情報（住所・生年月日・口座・緊急連絡先）なので、読み込みも POST で受ける：
 * アプリは GET の返事を iPad のファイルに保存して次に先に出す（NativeAPI.send → NativeDiskCache）。
 * レジの iPad は何人もが使うので、個人情報はそこに残さない（POST は保存しない）。
 *   POST { type: 'employeesLoad' } … 一覧（staff.manage）
 *   POST { type: 'employeeLoad', id } … 詳細（staff.manage か本人。機密・社会保険は payroll.view_all）
 *   POST { type: 'employeeCreate' | 'employeeBasic' | 'employeeConfidential' | 'employeeInsurance', … } … 保存（payroll.manage）
 * 中身は Web と同じ（lib/employees-server.ts・app/app/employees/actions.ts）。ここは形の確かめだけ（純粋な関数）。
 */

export type NativeEmployeeAction =
  | { type: 'employeesLoad' }
  | { type: 'employeeLoad'; id: string }
  | { type: 'employeeCreate'; input: CreateEmployeeInput }
  | { type: 'employeeBasic'; input: UpdateEmployeeBasicInput }
  | { type: 'employeeConfidential'; input: UpdateEmployeeConfidentialInput }
  | { type: 'employeeInsurance'; input: UpdateEmployeeInsuranceInput };

export const NATIVE_EMPLOYEE_ACTION_TYPES = [
  'employeesLoad',
  'employeeLoad',
  'employeeCreate',
  'employeeBasic',
  'employeeConfidential',
  'employeeInsurance',
] as const satisfies readonly NativeEmployeeAction['type'][];

export function isNativeEmployeeActionType(v: unknown): v is NativeEmployeeAction['type'] {
  return typeof v === 'string' && (NATIVE_EMPLOYEE_ACTION_TYPES as readonly string[]).includes(v);
}

type Parsed = { ok: true; action: NativeEmployeeAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });

/** 文字（ふつうの入力より十分長い上限で切る＝大きすぎる送信だけを止める）。文字でなければ空 */
const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : '');
/** 日付（空・null は null。形が違えば undefined＝エラー） */
const optDate = (v: unknown): string | null | undefined => {
  if (v == null || v === '') return null;
  return isYmd(v) ? v : undefined;
};
/** 店舗（空・null は null。UUID でなければ undefined＝エラー） */
const optStore = (v: unknown): string | null | undefined => {
  if (v == null || v === '') return null;
  return isUuid(v) ? v : undefined;
};

/**
 * 標準報酬月額の入力（Web の InsuranceForm と同じ：空は null、数字だけ、0 以上）。
 * 数字以外が入っていたら undefined（「標準報酬月額は0以上の数値で入力してください」）
 */
export function parseRemuneration(v: unknown): number | null | undefined {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : undefined;
}

export function parseNativeEmployeeAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'employeesLoad':
      return { ok: true, action: { type: 'employeesLoad' } };
    case 'employeeLoad':
      if (!isUuid(b.id)) return bad('従業員情報が見つかりません');
      return { ok: true, action: { type: 'employeeLoad', id: b.id } };
    case 'employeeCreate': {
      if (!isUuid(b.profileId)) return bad('対象スタッフを選択してください');
      const primaryStoreId = optStore(b.primaryStoreId);
      const hiredOn = optDate(b.hiredOn);
      if (primaryStoreId === undefined) return bad('所属店舗が正しくありません');
      if (hiredOn === undefined) return bad('入社日が正しくありません');
      return {
        ok: true,
        action: {
          type: 'employeeCreate',
          input: { profileId: b.profileId, employeeNo: str(b.employeeNo), employmentType: str(b.employmentType, 50), primaryStoreId, hiredOn },
        },
      };
    }
    case 'employeeBasic': {
      if (!isUuid(b.id)) return bad('対象の従業員が見つかりません');
      const primaryStoreId = optStore(b.primaryStoreId);
      const birthDate = optDate(b.birthDate);
      const hiredOn = optDate(b.hiredOn);
      const terminatedOn = optDate(b.terminatedOn);
      if (primaryStoreId === undefined) return bad('所属店舗が正しくありません');
      if (birthDate === undefined || hiredOn === undefined || terminatedOn === undefined) return bad('日付が正しくありません');
      return {
        ok: true,
        action: {
          type: 'employeeBasic',
          input: {
            id: b.id,
            employeeNo: str(b.employeeNo),
            legalName: str(b.legalName),
            legalNameKana: str(b.legalNameKana),
            postalCode: str(b.postalCode),
            address: str(b.address),
            birthDate,
            hiredOn,
            terminatedOn,
            employmentType: str(b.employmentType, 50),
            position: str(b.position),
            primaryStoreId,
            status: str(b.status, 50),
          },
        },
      };
    }
    case 'employeeConfidential': {
      if (!isUuid(b.id)) return bad('対象の従業員が見つかりません');
      const bank = (b.bank && typeof b.bank === 'object' ? b.bank : {}) as Record<string, unknown>;
      const emergency = (b.emergency && typeof b.emergency === 'object' ? b.emergency : {}) as Record<string, unknown>;
      // 口座番号は末尾4桁のみ（Web の入力欄と同じく数字以外は落として 4 桁まで）。4 桁でなければ Server Action が断る
      const last4 = str(bank.last4, 50).replace(/[^\d]/g, '').slice(0, 4);
      return {
        ok: true,
        action: {
          type: 'employeeConfidential',
          input: {
            id: b.id,
            bank: { bank: str(bank.bank), branch: str(bank.branch), type: str(bank.type), last4, holder: str(bank.holder) },
            emergency: { name: str(emergency.name), relation: str(emergency.relation), phone: str(emergency.phone) },
          },
        },
      };
    }
    case 'employeeInsurance': {
      if (!isUuid(b.employeeId)) return bad('対象の従業員が見つかりません');
      const standardMonthlyRemuneration = parseRemuneration(b.standardMonthlyRemuneration);
      if (standardMonthlyRemuneration === undefined) return bad('標準報酬月額は0以上の数値で入力してください');
      const acquiredOn = optDate(b.acquiredOn);
      const lostOn = optDate(b.lostOn);
      if (acquiredOn === undefined || lostOn === undefined) return bad('日付が正しくありません');
      return {
        ok: true,
        action: {
          type: 'employeeInsurance',
          input: {
            employeeId: b.employeeId,
            healthInsurance: b.healthInsurance === true,
            pension: b.pension === true,
            employmentInsurance: b.employmentInsurance === true,
            careInsurance: b.careInsurance === true,
            standardMonthlyRemuneration,
            acquiredOn,
            lostOn,
            region: str(b.region),
            note: str(b.note, 10000),
          },
        },
      };
    }
    default:
      return bad();
  }
}
