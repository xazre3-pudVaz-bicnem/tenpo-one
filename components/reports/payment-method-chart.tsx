'use client';

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LabelList } from 'recharts';

export interface PaymentMethodPoint {
  label: string; // '現金' 等の日本語ラベル
  amount: number;
}

/** 支払方法別構成（横棒グラフ） */
export function PaymentMethodChart({ data }: { data: PaymentMethodPoint[] }) {
  const height = Math.max(160, data.length * 44);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 48, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: '#6B7280' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}万` : String(v))}
          />
          <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: '#0F1120' }} tickLine={false} axisLine={false} width={96} />
          <Tooltip
            formatter={(value) => [`¥${Number(value).toLocaleString('ja-JP')}`, '金額']}
            labelStyle={{ color: '#0F1120', fontWeight: 600 }}
            contentStyle={{ borderRadius: 12, border: '1px solid #E5E7EB', fontSize: 12 }}
            cursor={{ fill: '#7B3FF2', fillOpacity: 0.06 }}
          />
          <Bar dataKey="amount" fill="#7B3FF2" radius={[0, 4, 4, 0]} maxBarSize={24}>
            <LabelList
              dataKey="amount"
              position="right"
              formatter={(v) => `¥${Number(v).toLocaleString('ja-JP')}`}
              style={{ fill: '#0F1120', fontSize: 11, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
