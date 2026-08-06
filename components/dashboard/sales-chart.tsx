'use client';

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

export interface DailyPoint {
  date: string; // 'M/D'
  sales: number;
}

export function SalesChart({ data }: { data: DailyPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7B3FF2" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#7B3FF2" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} minTickGap={24} />
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
          />
          <Area type="monotone" dataKey="sales" stroke="#7B3FF2" strokeWidth={2} fill="url(#salesGradient)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
