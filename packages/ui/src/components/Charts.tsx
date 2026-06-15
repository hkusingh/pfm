import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  TooltipProps,
} from 'recharts';
import { chart } from '../tokens';

// ─── Shared tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, formatValue }: TooltipProps<number, string> & { formatValue?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{ background: chart.tooltip.bg, color: chart.tooltip.text, border: `1px solid ${chart.tooltip.border}` }}
    >
      {label && <p className="font-medium mb-1">{label}</p>}
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.color }}>
          {entry.name}: {formatValue ? formatValue(entry.value as number) : entry.value}
        </p>
      ))}
    </div>
  );
}

// ─── Spend bar chart ──────────────────────────────────────────────────────────

interface BarData {
  name: string;
  [key: string]: string | number;
}

interface SpendBarChartProps {
  data: BarData[];
  bars: { key: string; label: string; color?: string; stackId?: string; colorByValue?: (v: number) => string }[];
  formatValue?: (v: number) => string;
  height?: number;
  barRadius?: number | [number, number, number, number];
  showLegend?: boolean;
}

export function SpendBarChart({ data, bars, formatValue, height = 300, barRadius = 0, showLegend = true }: SpendBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={formatValue} />
        <Tooltip content={(props) => <ChartTooltip {...(props as TooltipProps<number, string>)} formatValue={formatValue} />} />
        {showLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {bars.map((bar, i) => (
          <Bar key={bar.key} dataKey={bar.key} name={bar.label} fill={bar.color ?? chart.palette[i % chart.palette.length]} radius={barRadius} isAnimationActive={false} stackId={bar.stackId}>
            {bar.colorByValue && data.map((entry, idx) => (
              <Cell key={idx} fill={bar.colorByValue!(entry[bar.key] as number)} />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Trend line chart ─────────────────────────────────────────────────────────

interface LineData {
  name: string;
  [key: string]: string | number;
}

interface TrendLineChartProps {
  data: LineData[];
  lines: { key: string; label: string; color?: string }[];
  formatValue?: (v: number) => string;
  height?: number;
  showLegend?: boolean;
}

export function TrendLineChart({ data, lines, formatValue, height = 300, showLegend = true }: TrendLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={formatValue} />
        <Tooltip content={(props) => <ChartTooltip {...(props as TooltipProps<number, string>)} formatValue={formatValue} />} />
        {showLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {lines.map((line, i) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            name={line.label}
            stroke={line.color ?? chart.palette[i % chart.palette.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Donut / pie chart ────────────────────────────────────────────────────────

interface PieData {
  name: string;
  value: number;
  color?: string;
}

interface DonutChartProps {
  data: PieData[];
  formatValue?: (v: number) => string;
  height?: number;
  innerRadius?: number;
  onSliceClick?: (entry: PieData) => void;
}

export function DonutChart({ data, formatValue, height = 260, innerRadius = 60, onSliceClick }: DonutChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={innerRadius + 40}
          paddingAngle={2}
          dataKey="value"
          onClick={onSliceClick ? (entry) => onSliceClick(entry as PieData) : undefined}
          style={onSliceClick ? { cursor: 'pointer' } : undefined}
        >
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={entry.color ?? chart.palette[i % chart.palette.length]} />
          ))}
        </Pie>
        <Tooltip content={(props) => <ChartTooltip {...(props as TooltipProps<number, string>)} formatValue={formatValue} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
