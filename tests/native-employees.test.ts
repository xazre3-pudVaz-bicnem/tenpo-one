import { describe, expect, it } from 'vitest';
import {
  isNativeEmployeeActionType,
  NATIVE_EMPLOYEE_ACTION_TYPES,
  parseNativeEmployeeAction,
  parseRemuneration,
} from '@/lib/native-employees';

const ID = '11111111-2222-4333-8444-555555555555';
const STORE = '66666666-7777-4888-9999-000000000000';

describe('parseRemuneration（Web の InsuranceForm と同じ）', () => {
  it('空は null、数字だけ、0 以上', () => {
    expect(parseRemuneration('')).toBeNull();
    expect(parseRemuneration('  ')).toBeNull();
    expect(parseRemuneration(null)).toBeNull();
    expect(parseRemuneration(undefined)).toBeNull();
    expect(parseRemuneration('280000')).toBe(280000);
    expect(parseRemuneration(0)).toBe(0);
    expect(parseRemuneration(-1)).toBeUndefined();
    expect(parseRemuneration('28万')).toBeUndefined();
    expect(parseRemuneration('1.5')).toBeUndefined();
    expect(parseRemuneration(true)).toBeUndefined();
  });
});

describe('parseNativeEmployeeAction', () => {
  it('種類の一覧と判定', () => {
    for (const t of NATIVE_EMPLOYEE_ACTION_TYPES) expect(isNativeEmployeeActionType(t)).toBe(true);
    expect(isNativeEmployeeActionType('shiftUpsert')).toBe(false);
  });

  it('読み込み（一覧・詳細）', () => {
    expect(parseNativeEmployeeAction({ type: 'employeesLoad' })).toEqual({ ok: true, action: { type: 'employeesLoad' } });
    expect(parseNativeEmployeeAction({ type: 'employeeLoad', id: ID })).toEqual({ ok: true, action: { type: 'employeeLoad', id: ID } });
    expect(parseNativeEmployeeAction({ type: 'employeeLoad', id: '1' })).toEqual({ ok: false, error: '従業員情報が見つかりません' });
  });

  it('employeeCreate（空の店舗・入社日は null）', () => {
    expect(
      parseNativeEmployeeAction({ type: 'employeeCreate', profileId: ID, employeeNo: 'A01', employmentType: 'part_time', primaryStoreId: '', hiredOn: '' })
    ).toEqual({
      ok: true,
      action: { type: 'employeeCreate', input: { profileId: ID, employeeNo: 'A01', employmentType: 'part_time', primaryStoreId: null, hiredOn: null } },
    });
    expect(
      parseNativeEmployeeAction({ type: 'employeeCreate', profileId: ID, employmentType: 'full_time', primaryStoreId: STORE, hiredOn: '2026-04-01' })
    ).toEqual({
      ok: true,
      action: { type: 'employeeCreate', input: { profileId: ID, employeeNo: '', employmentType: 'full_time', primaryStoreId: STORE, hiredOn: '2026-04-01' } },
    });
    expect(parseNativeEmployeeAction({ type: 'employeeCreate', profileId: '' })).toEqual({ ok: false, error: '対象スタッフを選択してください' });
    expect(parseNativeEmployeeAction({ type: 'employeeCreate', profileId: ID, primaryStoreId: 'x' }).ok).toBe(false);
    expect(parseNativeEmployeeAction({ type: 'employeeCreate', profileId: ID, hiredOn: '2026/04/01' }).ok).toBe(false);
  });

  it('employeeBasic（全項目。日付は空なら null）', () => {
    const r = parseNativeEmployeeAction({
      type: 'employeeBasic',
      id: ID,
      employeeNo: 'A01',
      legalName: '山田 太郎',
      legalNameKana: 'ヤマダ タロウ',
      postalCode: '123-4567',
      address: '東京都',
      birthDate: '1990-01-02',
      hiredOn: '',
      terminatedOn: null,
      employmentType: 'contract',
      position: '店長',
      primaryStoreId: STORE,
      status: 'retired',
    });
    expect(r).toEqual({
      ok: true,
      action: {
        type: 'employeeBasic',
        input: {
          id: ID,
          employeeNo: 'A01',
          legalName: '山田 太郎',
          legalNameKana: 'ヤマダ タロウ',
          postalCode: '123-4567',
          address: '東京都',
          birthDate: '1990-01-02',
          hiredOn: null,
          terminatedOn: null,
          employmentType: 'contract',
          position: '店長',
          primaryStoreId: STORE,
          status: 'retired',
        },
      },
    });
    expect(parseNativeEmployeeAction({ type: 'employeeBasic', id: ID, birthDate: '1990-02-30' })).toEqual({ ok: false, error: '日付が正しくありません' });
  });

  it('employeeConfidential（口座は末尾4桁の数字だけ送る）', () => {
    const r = parseNativeEmployeeAction({
      type: 'employeeConfidential',
      id: ID,
      bank: { bank: 'みずほ', branch: '新宿', type: '普通', last4: '12-3456', holder: 'ヤマダ' },
      emergency: { name: '山田 花子', relation: '母', phone: '090' },
    });
    expect(r).toEqual({
      ok: true,
      action: {
        type: 'employeeConfidential',
        input: {
          id: ID,
          bank: { bank: 'みずほ', branch: '新宿', type: '普通', last4: '1234', holder: 'ヤマダ' },
          emergency: { name: '山田 花子', relation: '母', phone: '090' },
        },
      },
    });
    const empty = parseNativeEmployeeAction({ type: 'employeeConfidential', id: ID });
    expect(empty.ok && empty.action.type === 'employeeConfidential' ? empty.action.input.bank.last4 : 'x').toBe('');
  });

  it('employeeInsurance', () => {
    const r = parseNativeEmployeeAction({
      type: 'employeeInsurance',
      employeeId: ID,
      healthInsurance: true,
      pension: true,
      employmentInsurance: 'yes',
      careInsurance: false,
      standardMonthlyRemuneration: '300000',
      acquiredOn: '2026-04-01',
      lostOn: '',
      region: '東京都',
      note: 'メモ',
    });
    expect(r).toEqual({
      ok: true,
      action: {
        type: 'employeeInsurance',
        input: {
          employeeId: ID,
          healthInsurance: true,
          pension: true,
          employmentInsurance: false,
          careInsurance: false,
          standardMonthlyRemuneration: 300000,
          acquiredOn: '2026-04-01',
          lostOn: null,
          region: '東京都',
          note: 'メモ',
        },
      },
    });
    expect(parseNativeEmployeeAction({ type: 'employeeInsurance', employeeId: ID, standardMonthlyRemuneration: 'abc' })).toEqual({
      ok: false,
      error: '標準報酬月額は0以上の数値で入力してください',
    });
  });

  it('知らない形は断る', () => {
    expect(parseNativeEmployeeAction(null).ok).toBe(false);
    expect(parseNativeEmployeeAction('employeesLoad').ok).toBe(false);
    expect(parseNativeEmployeeAction({ type: 'employeeDelete', id: ID }).ok).toBe(false);
  });
});
