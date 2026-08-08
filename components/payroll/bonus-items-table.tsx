import { yen } from '@/lib/format';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';

export interface BonusItemView {
  id: string;
  profileName: string;
  amount: number;
}

/** 賞与runの明細表示（勤怠集計を含まないシンプルな支給額一覧） */
export function BonusItemsTable({ items }: { items: BonusItemView[] }) {
  const total = items.reduce((a, i) => a + i.amount, 0);

  return (
    <TableWrap>
      <Table>
        <THead>
          <Tr>
            <Th>スタッフ</Th>
            <Th className="text-right">支給額</Th>
          </Tr>
        </THead>
        <TBody>
          {items.map((item) => (
            <Tr key={item.id}>
              <Td className="font-medium text-navy">{item.profileName}</Td>
              <Td className="text-right font-semibold tabular-nums text-navy">{yen(item.amount)}</Td>
            </Tr>
          ))}
        </TBody>
        <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-navy">
          <tr>
            <td className="px-4 py-3">合計</td>
            <td className="px-4 py-3 text-right tabular-nums">{yen(total)}</td>
          </tr>
        </tfoot>
      </Table>
    </TableWrap>
  );
}
