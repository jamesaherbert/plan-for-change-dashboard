"use client";

import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";
import type { KpiSnapshot } from "@/lib/types";

interface SparklineChartProps {
  data: KpiSnapshot[];
  color?: string;
  height?: number;
  showTooltip?: boolean;
}

export default function SparklineChart({
  data,
  color = "#1d4ed8",
  height = 60,
  showTooltip = true,
}: SparklineChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-[var(--muted)]"
        style={{ height }}
      >
        No data available
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: d.label || d.date,
    value: d.value,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData}>
        <defs>
          <linearGradient id={`gradient-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.2} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis domain={["dataMin", "dataMax"]} hide />
        {showTooltip && (
          <Tooltip
            contentStyle={{
              fontSize: "12px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
            }}
            formatter={(value) => [Number(value).toFixed(1), "Value"]}
            labelFormatter={(label) => String(label)}
          />
        )}
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#gradient-${color})`}
          dot={false}
          activeDot={{ r: 3, fill: color }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
