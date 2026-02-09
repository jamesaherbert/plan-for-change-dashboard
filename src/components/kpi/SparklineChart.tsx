"use client";

import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  YAxis,
  ReferenceLine,
} from "recharts";
import type { KpiSnapshot } from "@/lib/types";

interface SparklineChartProps {
  data: KpiSnapshot[];
  color?: string;
  height?: number;
  showTooltip?: boolean;
  targetValue?: number; // Optional horizontal target line
}

export default function SparklineChart({
  data,
  color = "#1d4ed8",
  height = 60,
  showTooltip = true,
  targetValue,
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

  // Compute Y domain to include target line if provided
  const values = chartData.map((d) => d.value);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const yMin = targetValue !== undefined ? Math.min(dataMin, targetValue) : dataMin;
  const yMax = targetValue !== undefined ? Math.max(dataMax, targetValue) : dataMax;
  const yPadding = (yMax - yMin) * 0.05 || 1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData}>
        <defs>
          <linearGradient id={`gradient-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.2} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis
          domain={[yMin - yPadding, yMax + yPadding]}
          hide
        />
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
        {targetValue !== undefined && (
          <ReferenceLine
            y={targetValue}
            stroke="#16a34a"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            label={{
              value: `Target: ${targetValue}`,
              position: "right",
              fill: "#16a34a",
              fontSize: 10,
            }}
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
