import { useId } from "react";
import { money, moneyAxis, moneyCompact } from "../lib/format";

/* ============================================================== cash flow */

export interface CashFlowPoint {
  label: string;
  income: number;
  expense: number;
}

const W = 640;
const H = 220;
const PAD_X = 46;
const PAD_TOP = 16;
const PAD_BOTTOM = 30;

function buildPath(
  values: number[],
  max: number,
  count: number,
  close: boolean,
): string {
  if (count === 0) return "";
  const stepX = count > 1 ? (W - PAD_X * 2) / (count - 1) : 0;
  const usableH = H - PAD_TOP - PAD_BOTTOM;

  const points = values.map((value, index) => {
    const x = PAD_X + stepX * index + (count === 1 ? (W - PAD_X * 2) / 2 : 0);
    const y = PAD_TOP + usableH - (max > 0 ? (value / max) * usableH : 0);
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");

  if (!close) return line;

  const firstX = points[0][0];
  const lastX = points[points.length - 1][0];
  const baseY = PAD_TOP + usableH;
  return `${line} L${lastX.toFixed(1)} ${baseY} L${firstX.toFixed(1)} ${baseY} Z`;
}

/**
 * Up to seven monthly points, drawn from saved transactions only. Uses a
 * viewBox so labels scale instead of clipping at any width.
 */
export function CashFlowChart({ points }: { points: CashFlowPoint[] }) {
  const incomeGradient = useId();
  const expenseGradient = useId();

  const max = Math.max(
    1,
    ...points.map((p) => Math.max(p.income, p.expense)),
  );
  const count = points.length;
  const usableH = H - PAD_TOP - PAD_BOTTOM;
  const baseY = PAD_TOP + usableH;
  const stepX = count > 1 ? (W - PAD_X * 2) / (count - 1) : 0;

  const summary = points
    .map(
      (p) =>
        `${p.label}: income ${money(p.income)}, spending ${money(p.expense)}`,
    )
    .join("; ");

  return (
    <figure className="chart-frame" style={{ margin: 0 }}>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Cash flow by month. ${summary}`}
      >
        <defs>
          <linearGradient id={incomeGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6558D3" stopOpacity="0.30" />
            <stop offset="100%" stopColor="#6558D3" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={expenseGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D97316" stopOpacity="0.20" />
            <stop offset="100%" stopColor="#D97316" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = PAD_TOP + usableH * fraction;
          return (
            <g key={fraction}>
              <line
                x1={PAD_X}
                x2={W - PAD_X + 8}
                y1={y}
                y2={y}
                stroke="#E4E5EC"
                strokeWidth="1"
              />
              <text
                x={PAD_X - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#7A8095"
              >
                {moneyAxis(max * (1 - fraction))}
              </text>
            </g>
          );
        })}

        <path
          d={buildPath(points.map((p) => p.income), max, count, true)}
          fill={`url(#${incomeGradient})`}
        />
        <path
          d={buildPath(points.map((p) => p.expense), max, count, true)}
          fill={`url(#${expenseGradient})`}
        />
        <path
          d={buildPath(points.map((p) => p.expense), max, count, false)}
          fill="none"
          stroke="#D97316"
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={buildPath(points.map((p) => p.income), max, count, false)}
          fill="none"
          stroke="#6558D3"
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((point, index) => {
          const x =
            PAD_X + stepX * index + (count === 1 ? (W - PAD_X * 2) / 2 : 0);
          const incomeY =
            PAD_TOP + usableH - (max > 0 ? (point.income / max) * usableH : 0);
          const expenseY =
            PAD_TOP + usableH - (max > 0 ? (point.expense / max) * usableH : 0);
          return (
            <g key={point.label}>
              <circle cx={x} cy={expenseY} r="3.4" fill="#D97316" />
              <circle cx={x} cy={incomeY} r="3.8" fill="#6558D3" />
              <text
                x={x}
                y={baseY + 19}
                textAnchor="middle"
                fontSize="12"
                fill="#7A8095"
              >
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="row" style={{ gap: 14, marginTop: 6 }}>
        <span className="pill pill--violet">Income</span>
        <span className="pill pill--orange">Spending</span>
      </figcaption>
    </figure>
  );
}

/* ================================================================== donut */

export interface DonutSlice {
  name: string;
  value: number;
}

export const CATEGORY_COLORS = [
  "#6558D3",
  "#17915D",
  "#D97316",
  "#2B6CB0",
  "#8A7EE6",
  "#C2413C",
  "#1E2340",
  "#4FA88B",
  "#B58BD6",
  "#7A8095",
];

export function colorForIndex(index: number): string {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  startAngle: number,
  endAngle: number,
): string {
  // A full circle cannot be drawn as one arc; nudge it just under 360°.
  const sweep = Math.min(endAngle - startAngle, 359.99);
  const end = startAngle + sweep;
  const largeArc = sweep > 180 ? 1 : 0;

  const p1 = polarToCartesian(cx, cy, outer, startAngle);
  const p2 = polarToCartesian(cx, cy, outer, end);
  const p3 = polarToCartesian(cx, cy, inner, end);
  const p4 = polarToCartesian(cx, cy, inner, startAngle);

  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `A ${outer} ${outer} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    `A ${inner} ${inner} 0 ${largeArc} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

export function CategoryDonut({
  slices,
  total,
}: {
  slices: DonutSlice[];
  total: number;
}) {
  const size = 190;
  const cx = size / 2;
  const cy = size / 2;
  let angle = 0;

  const summary = slices
    .map(
      (s) =>
        `${s.name}: ${money(s.value)} (${
          total > 0 ? Math.round((s.value / total) * 100) : 0
        }%)`,
    )
    .join("; ");

  return (
    <div className="row" style={{ gap: 20, alignItems: "center" }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Spending by category. ${summary}`}
        style={{ flex: "0 0 auto" }}
      >
        {slices.map((slice, index) => {
          const sweep = total > 0 ? (slice.value / total) * 360 : 0;
          const path = arcPath(cx, cy, 88, 58, angle, angle + sweep);
          angle += sweep;
          return (
            <path
              key={slice.name}
              d={path}
              fill={colorForIndex(index)}
              stroke="#fff"
              strokeWidth="1.5"
            />
          );
        })}
        <text
          x={cx}
          y={cy - 3}
          textAnchor="middle"
          fontSize="13"
          fill="#7A8095"
        >
          Spending
        </text>
        <text
          x={cx}
          y={cy + 17}
          textAnchor="middle"
          fontSize="16"
          fontWeight="700"
          fill="#1C1F2B"
        >
          {moneyCompact(total)}
        </text>
      </svg>

      <ul className="legend" style={{ flex: 1, minWidth: 170 }}>
        {slices.map((slice, index) => (
          <li key={slice.name}>
            <span
              className="legend__swatch"
              style={{ background: colorForIndex(index) }}
              aria-hidden="true"
            />
            <span className="legend__name">{slice.name}</span>
            <span className="legend__value">{money(slice.value)}</span>
            <span className="legend__pct">
              {total > 0 ? Math.round((slice.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
