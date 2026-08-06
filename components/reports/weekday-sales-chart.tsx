'use client';

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

export interface WeekdaySalesPoint {
  weekday: string; // '月'
  sales: number;
}

/** 曜日別売上（棒グラフ） */
export function WeekdaySalesChart({ data }: { data: WeekdaySalesPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
          <XAxis dataKey="weekday" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: '#6B7280' }}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}万` : String(v))}
          />
          <Tooltip
            formatter={(value) => [`¥${Number(value).toLocaleString('ja-JP')}`, '売上']}
            labelStyle={{ color: '#0F1120', fontWeight: 600 }}
            contentStyle={{ borderRadius: 12, border: '1px solid #E5E7EB', fontSize: 12 }}
            cursor={{ fill: '#7B3FF2', fillOpacity: 0.06 }}
          />
          <Bar dataKey="sales" fill="#7B3FF2" radius={[4, 4, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
