import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Box, Paper, Stack, Typography } from '@mui/material';
import dayjs from 'dayjs';
import { palette, severityLabel } from '../theme/tokens.js';

/**
 * Chart conventions used throughout (see the platform design notes):
 *  - recessive chrome: hairline horizontal grid only, muted axis ink, no axis lines
 *  - thin marks: 2px strokes, 4px rounded bar ends, ≥8px hover markers
 *  - every chart carries a hover layer; ≥2 series always carry a legend
 *  - severity uses the reserved status palette and is always labelled in words
 */
const axisStyle = { fontSize: 12, fill: palette.ink.muted };

const TooltipCard = ({ title, rows }) => (
  <Paper
    elevation={0}
    sx={{
      px: 1.5,
      py: 1.25,
      borderRadius: 2,
      background: 'rgba(255,255,255,0.92)',
      backdropFilter: 'blur(10px)',
      border: `1px solid ${palette.surface.glassEdge}`,
      boxShadow: '0 14px 34px -20px rgba(11,11,11,0.5)',
    }}
  >
    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
      {title}
    </Typography>
    <Stack spacing={0.4} sx={{ mt: 0.6 }}>
      {rows.map((row) => (
        <Stack key={row.label} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 9, height: 9, borderRadius: '2px', background: row.color }} />
            <Typography variant="body2" color="text.secondary">
              {row.label}
            </Typography>
          </Stack>
          <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {row.value}
          </Typography>
        </Stack>
      ))}
    </Stack>
  </Paper>
);

const seriesTooltip =
  (labels) =>
  ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <TooltipCard
        title={dayjs(label).isValid() && String(label).includes('-') ? dayjs(label).format('D MMM YYYY') : label}
        rows={payload.map((entry) => ({
          label: labels[entry.dataKey] || entry.name,
          value: entry.value,
          color: entry.color || entry.fill,
        }))}
      />
    );
  };

/**
 * Findings discovered over time. Two series — total findings (categorical slot 1)
 * and critical findings (status critical) — a pair validated for CVD separation
 * on this surface.
 */
export const FindingsTrendChart = ({ data = [], height = 280 }) => (
  <ResponsiveContainer width="100%" height={height}>
    <ComposedChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
      <defs>
        <linearGradient id="trend-total" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.brand[500]} stopOpacity={0.28} />
          <stop offset="100%" stopColor={palette.brand[500]} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <CartesianGrid stroke={palette.ink.grid} strokeDasharray="0" vertical={false} />
      <XAxis
        dataKey="date"
        tick={axisStyle}
        tickLine={false}
        axisLine={false}
        tickFormatter={(value) => dayjs(value).format('D MMM')}
        minTickGap={24}
      />
      <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
      <Tooltip
        cursor={{ stroke: palette.ink.axis, strokeWidth: 1 }}
        content={seriesTooltip({ findings: 'Findings', critical: 'Critical' })}
      />
      <Legend
        verticalAlign="top"
        align="right"
        height={28}
        iconType="plainline"
        formatter={(value) => (
          <span style={{ color: palette.ink.secondary, fontSize: 12 }}>
            {value === 'findings' ? 'Findings' : 'Critical'}
          </span>
        )}
      />
      <Area
        type="monotone"
        dataKey="findings"
        stroke={palette.brand[500]}
        strokeWidth={2}
        fill="url(#trend-total)"
        activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
      />
      <Line
        type="monotone"
        dataKey="critical"
        stroke={palette.severity.critical}
        strokeWidth={2}
        dot={false}
        activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
      />
    </ComposedChart>
  </ResponsiveContainer>
);

/** Open findings by severity: magnitude across four named states, direct-labelled. */
export const SeverityBarChart = ({ counts = {}, height = 240 }) => {
  const data = ['critical', 'high', 'medium', 'low'].map((severity) => ({
    severity,
    label: severityLabel[severity],
    count: counts[severity] || 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 44, left: 8, bottom: 0 }} barCategoryGap={10}>
        <CartesianGrid stroke={palette.ink.grid} horizontal={false} />
        <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ ...axisStyle, fontWeight: 600 }}
          tickLine={false}
          axisLine={false}
          width={72}
        />
        <Tooltip cursor={{ fill: 'rgba(11,11,11,0.04)' }} content={seriesTooltip({ count: 'Open findings' })} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((entry) => (
            <Cell key={entry.severity} fill={palette.severity[entry.severity]} />
          ))}
          <LabelList
            dataKey="count"
            position="right"
            style={{ fill: palette.ink.secondary, fontSize: 12, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

/** Ranked magnitude for one measure — a single hue, so no legend is needed. */
export const TopProjectsChart = ({ data = [], height = 260 }) => (
  <ResponsiveContainer width="100%" height={height}>
    <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 0 }} barCategoryGap={8}>
      <CartesianGrid stroke={palette.ink.grid} horizontal={false} />
      <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
      <YAxis
        type="category"
        dataKey="projectKey"
        tick={{ ...axisStyle, fontWeight: 600 }}
        tickLine={false}
        axisLine={false}
        width={78}
      />
      <Tooltip
        cursor={{ fill: 'rgba(11,11,11,0.04)' }}
        content={seriesTooltip({ open: 'Open findings', critical: 'Critical' })}
      />
      <Bar dataKey="open" fill={palette.brand[500]} radius={[0, 4, 4, 0]} maxBarSize={18}>
        <LabelList dataKey="open" position="right" style={{ fill: palette.ink.secondary, fontSize: 12, fontWeight: 600 }} />
      </Bar>
    </BarChart>
  </ResponsiveContainer>
);

/** Scan volume per day, split into succeeded and failed runs. */
export const ScanVolumeChart = ({ data = [], height = 220 }) => (
  <ResponsiveContainer width="100%" height={height}>
    <BarChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 0 }} barCategoryGap={6}>
      <CartesianGrid stroke={palette.ink.grid} vertical={false} />
      <XAxis
        dataKey="date"
        tick={axisStyle}
        tickLine={false}
        axisLine={false}
        tickFormatter={(value) => dayjs(value).format('D MMM')}
        minTickGap={20}
      />
      <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
      <Tooltip cursor={{ fill: 'rgba(11,11,11,0.04)' }} content={seriesTooltip({ succeeded: 'Succeeded', failed: 'Failed' })} />
      <Legend
        verticalAlign="top"
        align="right"
        height={28}
        iconType="square"
        formatter={(value) => (
          <span style={{ color: palette.ink.secondary, fontSize: 12 }}>
            {value === 'succeeded' ? 'Succeeded' : 'Failed'}
          </span>
        )}
      />
      {/* 2px surface gap between stacked segments keeps the boundary readable */}
      <Bar dataKey="succeeded" stackId="scans" fill={palette.brand[400]} maxBarSize={26} stroke="#fcfcfb" strokeWidth={2} />
      <Bar
        dataKey="failed"
        stackId="scans"
        fill={palette.severity.critical}
        radius={[4, 4, 0, 0]}
        maxBarSize={26}
        stroke="#fcfcfb"
        strokeWidth={2}
      />
    </BarChart>
  </ResponsiveContainer>
);

export default FindingsTrendChart;
