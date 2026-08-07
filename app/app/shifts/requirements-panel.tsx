'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { saveShiftRequirement, deleteShiftRequirement } from './actions';

const WEEKDAY_LABEL = ['日', '月', '火', '水', '木', '金', '土'];

export interface ShiftRequirementRow {
  id: string;
  day_of_week: number;
  time_from: string;
  time_to: string;
  required_count: number;
}

function hhmm(t: string) {
  return t.slice(0, 5);
}

/** 曜日・時間帯ごとの必要人数のCRUD（shifts.manage 権限者用） */
export function RequirementsPanel({ storeId, requirements }: { storeId: string; requirements: ShiftRequirementRow[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const remove = (id: string) => {
    startTransition(async () => {
      const result = await deleteShiftRequirement(id);
      toast(result.message, result.ok ? 'success' : 'error');
    });
  };

  const sorted = [...requirements].sort(
    (a, b) => a.day_of_week - b.day_of_week || a.time_from.localeCompare(b.time_from)
  );

  return (
    <Card className="mt-5">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>時間帯別 必要人数設定</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          追加
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {sorted.length === 0 ? (
          <div className="p-5">
            <EmptyState title="必要人数の設定がありません" description="「追加」から曜日・時間帯ごとの必要人数を登録してください" />
          </div>
        ) : (
          <TableWrap className="border-0">
            <Table>
              <THead>
                <Tr>
                  <Th>曜日</Th>
                  <Th>時間帯</Th>
                  <Th className="text-right">必要人数</Th>
                  <Th className="text-right">操作</Th>
                </Tr>
              </THead>
              <TBody>
                {sorted.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-medium text-navy">{WEEKDAY_LABEL[r.day_of_week]}曜日</Td>
                    <Td>
                      {hhmm(r.time_from)}〜{hhmm(r.time_to)}
                    </Td>
                    <Td className="text-right tabular-nums">{r.required_count}人</Td>
                    <Td className="text-right">
                      <button
                        type="button"
                        onClick={() => remove(r.id)}
                        disabled={pending}
                        className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-danger disabled:opacity-50"
                        aria-label="削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </CardContent>

      {open && <RequirementDialog storeId={storeId} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function RequirementDialog({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const [dayOfWeek, setDayOfWeek] = useState('1');
  const [timeFrom, setTimeFrom] = useState('11:00');
  const [timeTo, setTimeTo] = useState('15:00');
  const [requiredCount, setRequiredCount] = useState('2');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveShiftRequirement({
        storeId,
        dayOfWeek: Number(dayOfWeek),
        timeFrom,
        timeTo,
        requiredCount: Number(requiredCount) || 0,
      });
      toast(result.message, result.ok ? 'success' : 'error');
      if (result.ok) onClose();
      else setError(result.message);
    });
  };

  return (
    <Dialog open onClose={onClose} title="必要人数を追加">
      <div className="space-y-4">
        <div>
          <Label htmlFor="req-day">曜日</Label>
          <Select id="req-day" value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
            {WEEKDAY_LABEL.map((label, i) => (
              <option key={i} value={i}>
                {label}曜日
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="req-from">開始</Label>
            <Input id="req-from" type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="req-to">終了</Label>
            <Input id="req-to" type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="req-count">必要人数</Label>
          <Input
            id="req-count"
            type="number"
            min={1}
            value={requiredCount}
            onChange={(e) => setRequiredCount(e.target.value)}
          />
        </div>
        <FieldError message={error ?? undefined} />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          キャンセル
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending ? '保存中…' : '追加する'}
        </Button>
      </div>
    </Dialog>
  );
}
