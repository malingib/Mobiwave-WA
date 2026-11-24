import type { ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";

export const CHART = {
  primary: "#5955D1",
  positive: "#15966A",
  warning: "#D18A22",
  secondary: "#7D8AA5",
  negative: "#D14F5B",
};

type Series = { key: string; name: string; color: string };
type VolumeChartProps = {
  title: string;
  subtitle?: string;
  data: Array<Record<string, string | number>>;
  series: Series[];
  mode?: "bar";
  emptyText: string;
  formatter?: (value: number) => string;
};

export function VolumeChart({ title, subtitle, data, series, emptyText, formatter }: VolumeChartProps) {
  const hasData = data.some((row) => series.some((item) => Number(row[item.name] ?? 0) > 0));
  return (
    <section className="panel min-w-0">
      <header className="flex flex-wrap items-start justify-between gap-2 px-5 pb-1 pt-4">
        <div>
          <h2 className="text-[16px] font-bold text-text">{title}</h2>
          {subtitle && <p className="mt-1 text-[12px] text-text-muted">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap gap-3">
          {series.map((item) => (
            <span key={item.key} className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.name}
            </span>
          ))}
        </div>
      </header>
      <div className="h-[280px] px-3 pb-4 pt-3">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={6}>
              <CartesianGrid stroke="#eeeef3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#696981", fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} width={58} tick={{ fill: "#696981", fontSize: 11 }} tickFormatter={(value) => formatter ? formatter(Number(value)) : String(value)} />
              <Tooltip formatter={(value) => formatter ? formatter(Number(value)) : String(value)} />
              {series.map((item) => <Bar key={item.key} dataKey={item.name} name={item.name} fill={item.color} radius={[4, 4, 0, 0]} maxBarSize={34} />)}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-[12px] leading-relaxed text-text-muted">{emptyText}</div>
        )}
      </div>
    </section>
  );
}

type BreakdownCardProps = {
  title: string;
  subtitle?: string;
  data: Array<{ name: string; value: number; fill?: string }>;
  emptyText: string;
  formatter?: (value: number) => string;
};

export function BreakdownCard({ title, subtitle, data, emptyText, formatter }: BreakdownCardProps) {
  const total = data.reduce((sum, item) => sum + Number(item.value || 0), 0);
  return (
    <section className="panel min-w-0">
      <header className="px-5 pb-1 pt-4">
        <h2 className="text-[16px] font-bold text-text">{title}</h2>
        {subtitle && <p className="mt-1 text-[12px] text-text-muted">{subtitle}</p>}
      </header>
      {total > 0 ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 p-4">
          <div className="h-[150px] w-full max-w-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={68} paddingAngle={3}>
                  {data.map((item, index) => <Cell key={item.name + index} fill={item.fill || CHART.primary} />)}
                </Pie>
                <Tooltip formatter={(value) => formatter ? formatter(Number(value)) : String(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="w-full space-y-2">
            {data.map((item) => (
              <div key={item.name} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="flex min-w-0 items-center gap-2 text-text-muted"><span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: item.fill || CHART.primary }} />{item.name}</span>
                <strong className="text-text">{formatter ? formatter(item.value) : item.value.toLocaleString("en-KE")}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : <div className="flex min-h-[280px] items-center justify-center px-6 text-center text-[12px] leading-relaxed text-text-muted">{emptyText}</div>}
    </section>
  );
}

type TransactionTableProps = {
  title: string;
  subtitle?: string;
  head: string[];
  rows: ReactNode[][];
  empty: { title: string; text: string };
};

export function TransactionTable({ title, subtitle, head, rows, empty }: TransactionTableProps) {
  return (
    <section className="panel min-w-0 overflow-hidden">
      <header className="px-5 pb-3 pt-4">
        <h2 className="text-[16px] font-bold text-text">{title}</h2>
        {subtitle && <p className="mt-1 text-[12px] text-text-muted">{subtitle}</p>}
      </header>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead><tr>{head.map((item) => <th key={item} className="border-y border-hairline bg-raised px-4 py-2.5 font-semibold text-text-muted">{item}</th>)}</tr></thead>
            <tbody>{rows.map((row, index) => <tr key={index} className="border-b border-hairline last:border-0">{row.map((cell, cellIndex) => <td key={cellIndex} className="whitespace-nowrap px-4 py-3 text-text">{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="px-6 py-10 text-center"><strong className="block text-[13px] text-text">{empty.title}</strong><p className="mt-1 text-[12px] text-text-muted">{empty.text}</p></div>
      )}
    </section>
  );
}
