'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreVertical, ShieldCheck, Building2, KeyRound, LockKeyhole, Ban, RotateCcw } from 'lucide-react';
import { HQ_ROLES, type Role } from '@/lib/permissions';
import type { StoreRef } from '@/lib/auth';
import { RoleDialog } from './role-dialog';
import { StoresDialog } from './stores-dialog';
import { PinDialog } from './pin-dialog';
import { PasswordDialog } from './password-dialog';
import { StatusDialog } from './status-dialog';

export interface StaffRow {
  membershipId: string;
  profileId: string;
  displayName: string;
  role: Role;
  status: 'active' | 'invited' | 'suspended';
  storeIds: string[];
}

function isStoreScopedRole(role: Role): boolean {
  return !HQ_ROLES.includes(role);
}

type DialogKind = 'role' | 'stores' | 'pin' | 'password' | 'status';

export function StaffRowMenu({ row, stores, isSelf }: { row: StaffRow; stores: StoreRef[]; isSelf: boolean }) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const storeScoped = isStoreScopedRole(row.role);
  const openDialog = (kind: DialogKind) => {
    setOpen(false);
    setDialog(kind);
  };

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="操作メニュー"
        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {!isSelf && (
            <button
              type="button"
              onClick={() => openDialog('role')}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <ShieldCheck className="h-4 w-4 text-gray-400" />
              ロール変更
            </button>
          )}
          {storeScoped && (
            <button
              type="button"
              onClick={() => openDialog('stores')}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <Building2 className="h-4 w-4 text-gray-400" />
              所属店舗変更
            </button>
          )}
          <button
            type="button"
            onClick={() => openDialog('pin')}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <KeyRound className="h-4 w-4 text-gray-400" />
            PIN設定
          </button>
          {!isSelf && (
            <button
              type="button"
              onClick={() => openDialog('password')}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <LockKeyhole className="h-4 w-4 text-gray-400" />
              パスワード再発行
            </button>
          )}
          {!isSelf && (
            <button
              type="button"
              onClick={() => openDialog('status')}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft"
            >
              {row.status === 'suspended' ? (
                <>
                  <RotateCcw className="h-4 w-4" />
                  利用再開
                </>
              ) : (
                <>
                  <Ban className="h-4 w-4" />
                  利用停止
                </>
              )}
            </button>
          )}
        </div>
      )}

      {dialog === 'role' && (
        <RoleDialog
          membershipId={row.membershipId}
          profileId={row.profileId}
          currentRole={row.role}
          currentStoreIds={row.storeIds}
          stores={stores}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'stores' && (
        <StoresDialog
          membershipId={row.membershipId}
          profileId={row.profileId}
          currentStoreIds={row.storeIds}
          stores={stores}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'pin' && (
        <PinDialog membershipId={row.membershipId} profileId={row.profileId} onClose={() => setDialog(null)} />
      )}
      {dialog === 'password' && (
        <PasswordDialog
          membershipId={row.membershipId}
          profileId={row.profileId}
          displayName={row.displayName}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'status' && (
        <StatusDialog
          membershipId={row.membershipId}
          profileId={row.profileId}
          targetStatus={row.status === 'suspended' ? 'active' : 'suspended'}
          displayName={row.displayName}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
