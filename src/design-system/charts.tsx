import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { Text, YStack, useTheme } from "tamagui";

function scale(values: number[], width: number, height: number, pad = 2) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  return values.map((value, index) => ({
    x: index * stepX,
    y: pad + (1 - (value - min) / span) * (height - pad * 2),
  }));
}

function linePath(points: { x: number; y: number }[]): string {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    )
    .join(" ");
}

/** 迷你走势：按首尾涨跌自动取色。 */
export function Sparkline({
  values,
  width = 72,
  height = 28,
  tone,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: "positive" | "negative";
}) {
  const theme = useTheme();
  if (values.length < 2) return <YStack width={width} height={height} />;
  const up = tone
    ? tone === "positive"
    : (values[values.length - 1] ?? 0) >= (values[0] ?? 0);
  const color = up ? theme.pricePositive.val : theme.priceNegative.val;
  const points = scale(values, width, height);
  return (
    <Svg
      width={width}
      height={height}
      accessibilityRole="image"
      accessibilityLabel="sparkline"
    >
      <Path
        d={linePath(points)}
        stroke={color}
        strokeWidth={1.5}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export type CandleDatum = { o: number; h: number; l: number; c: number };

/** K 线：涨绿跌红（跟随主题 token），宽度自适应，蜡烛宽 = 70% 步长。 */
export function CandleChart({
  candles,
  height = 200,
}: {
  candles: CandleDatum[];
  height?: number;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) =>
    setWidth(Math.round(event.nativeEvent.layout.width));
  if (candles.length === 0)
    return <YStack height={height} onLayout={onLayout} />;
  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const span = max - min || 1;
  const step = width / candles.length;
  const body = Math.max(2, step * 0.7);
  const y = (value: number) => 6 + (1 - (value - min) / span) * (height - 12);
  return (
    <YStack height={height} onLayout={onLayout} accessibilityRole="image">
      {width > 0 ? (
        <Svg width={width} height={height}>
          {candles.map((candle, index) => {
            const up = candle.c >= candle.o;
            const color = up
              ? theme.pricePositive.val
              : theme.priceNegative.val;
            const x = index * step + step / 2;
            const top = y(Math.max(candle.o, candle.c));
            const bottom = y(Math.min(candle.o, candle.c));
            return (
              <YStack key={index}>
                <Line
                  x1={x}
                  x2={x}
                  y1={y(candle.h)}
                  y2={y(candle.l)}
                  stroke={color}
                  strokeWidth={1}
                />
                <Rect
                  x={x - body / 2}
                  y={top}
                  width={body}
                  height={Math.max(1, bottom - top)}
                  fill={color}
                />
              </YStack>
            );
          })}
        </Svg>
      ) : null}
    </YStack>
  );
}

// ---------------------------------------------------------------------------
// 交互式价格折线图（事件详情）
// ---------------------------------------------------------------------------

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  /** 毫秒时间戳 + 数值，按时间升序 */
  points: { t: number; v: number }[];
};

export type ChartSample = {
  /** 触点对应的时刻（毫秒） */
  t: number;
  /** 每条线在该时刻的值（相邻两点线性插值），线还没开始 / 已结束为 null */
  values: Record<string, number | null>;
};

const AXIS_WIDTH = 46;
const PAD_TOP = 8;
const PAD_BOTTOM = 18;
const SCRUB_START_PX = 6;

function sampleAt(points: ChartSeries["points"], t: number): number | null {
  if (points.length === 0) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (t <= first.t) return t === first.t ? first.v : null;
  if (t >= last.t) return t === last.t ? last.v : null;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  if (b.t === a.t) return a.v;
  return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
}

/**
 * 刻度：在值域内取 3–5 个"整"的刻度（步长从 1 / 2 / 5 / 10 / 20 / 25 / 50 里选），
 * 只取落在值域内的，保证一条 26–27% 的平线也能看到 25 / 26 / 27 这样的参照。
 */
function niceTicks(min: number, max: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const span = max - min;
  if (span < 1e-9) return [min];
  const step =
    [1, 2, 5, 10, 20, 25, 50].find((candidate) => span / candidate <= 5) ?? 50;
  const ticks: number[] = [];
  for (
    let tick = Math.ceil(min / step) * step;
    tick <= max + 1e-9;
    tick += step
  )
    ticks.push(Math.round(tick * 100) / 100);
  return ticks.reverse();
}

/**
 * 多线价格图：右侧刻度 + 虚线网格 + 末点圆点；单线时铺面积。
 * 横向拖动进入"刻度"模式：竖线 + 各线插值点 + 底部时间标签，并通过 `onScrub` 把
 * 该时刻的值交给上层（头部数字跟着手指走）。竖直拖动仍交给外层滚动。
 */
export function PriceLineChart({
  series,
  height = 180,
  baseline,
  formatValue,
  formatTime,
  onScrub,
  onScrubbing,
  empty,
}: {
  series: ChartSeries[];
  height?: number;
  /** 虚线基准（如 50¢） */
  baseline?: number;
  formatValue: (value: number) => string;
  formatTime: (tMs: number) => string;
  onScrub?: (sample: ChartSample | null) => void;
  /** 进入 / 离开刻度模式（上层据此暂停滚动） */
  onScrubbing?: (active: boolean) => void;
  /** 一条线都没有点时显示的内容 */
  empty?: ReactNode;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [scrubX, setScrubX] = useState<number | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const plotWidth = Math.max(0, width - AXIS_WIDTH);
  const plotHeight = Math.max(0, height - PAD_TOP - PAD_BOTTOM);

  const domain = useMemo(() => {
    const all = series.flatMap((item) => item.points);
    if (all.length === 0) return null;
    let t0 = Infinity;
    let t1 = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const point of all) {
      if (point.t < t0) t0 = point.t;
      if (point.t > t1) t1 = point.t;
      if (point.v < vMin) vMin = point.v;
      if (point.v > vMax) vMax = point.v;
    }
    if (baseline !== undefined) {
      vMin = Math.min(vMin, baseline);
      vMax = Math.max(vMax, baseline);
    }
    // 值域至少留 6 分的高度，不然一条平线会铺满整张图
    if (vMax - vMin < 6) {
      const mid = (vMax + vMin) / 2;
      vMin = mid - 3;
      vMax = mid + 3;
    }
    const pad = (vMax - vMin) * 0.08;
    return {
      t0,
      t1: t1 === t0 ? t0 + 1 : t1,
      vMin: vMin - pad,
      vMax: vMax + pad,
    };
  }, [baseline, series]);

  const x = useCallback(
    (t: number) =>
      domain ? ((t - domain.t0) / (domain.t1 - domain.t0)) * plotWidth : 0,
    [domain, plotWidth],
  );
  const y = useCallback(
    (v: number) =>
      domain
        ? PAD_TOP +
          (1 - (v - domain.vMin) / (domain.vMax - domain.vMin)) * plotHeight
        : 0,
    [domain, plotHeight],
  );

  const ticks = useMemo(
    () =>
      domain
        ? niceTicks(domain.vMin, domain.vMax).filter(
            (tick) => tick >= domain.vMin && tick <= domain.vMax,
          )
        : [],
    [domain],
  );

  const scrub = useCallback(
    (px: number | null) => {
      setScrubX(px);
      if (!onScrub) return;
      if (px === null || !domain) {
        onScrub(null);
        return;
      }
      const t = domain.t0 + (px / plotWidth) * (domain.t1 - domain.t0);
      const values: Record<string, number | null> = {};
      for (const item of series) values[item.key] = sampleAt(item.points, t);
      onScrub({ t, values });
    },
    [domain, onScrub, plotWidth, series],
  );

  const clampX = (value: number) => Math.min(plotWidth, Math.max(0, value));
  const onTouchStart = (event: GestureResponderEvent) => {
    touchStart.current = {
      x: event.nativeEvent.locationX,
      y: event.nativeEvent.locationY,
    };
  };
  const shouldScrub = (event: GestureResponderEvent) => {
    const start = touchStart.current;
    if (!start || !domain) return false;
    const dx = event.nativeEvent.locationX - start.x;
    const dy = event.nativeEvent.locationY - start.y;
    return Math.abs(dx) > SCRUB_START_PX && Math.abs(dx) > Math.abs(dy);
  };
  const onGrant = (event: GestureResponderEvent) => {
    onScrubbing?.(true);
    scrub(clampX(event.nativeEvent.locationX));
  };
  const onMove = (event: GestureResponderEvent) =>
    scrub(clampX(event.nativeEvent.locationX));
  const onEnd = () => {
    onScrubbing?.(false);
    scrub(null);
    touchStart.current = null;
  };

  const scrubT =
    scrubX !== null && domain
      ? domain.t0 + (scrubX / plotWidth) * (domain.t1 - domain.t0)
      : null;
  const single = series.length === 1;
  const gridColor = theme.borderColor.val;
  const labelColor = theme.textMuted.val;

  return (
    <View
      style={{ height }}
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      onTouchStart={onTouchStart}
      onStartShouldSetResponder={() => false}
      onMoveShouldSetResponder={shouldScrub}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onEnd}
      onResponderTerminate={onEnd}
      onResponderTerminationRequest={() => false}
      accessibilityRole="image"
      testID="price-line-chart"
    >
      {width > 0 && domain ? (
        <Svg width={width} height={height}>
          <Defs>
            {series.map((item) => (
              <LinearGradient
                key={item.key}
                id={`area-${item.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <Stop offset="0" stopColor={item.color} stopOpacity={0.26} />
                <Stop offset="1" stopColor={item.color} stopOpacity={0} />
              </LinearGradient>
            ))}
          </Defs>
          {ticks.map((tick) => (
            <Line
              key={tick}
              x1={0}
              x2={plotWidth}
              y1={y(tick)}
              y2={y(tick)}
              stroke={gridColor}
              strokeDasharray="3 4"
              strokeWidth={1}
            />
          ))}
          {ticks.map((tick) => (
            <SvgText
              key={`label-${tick}`}
              x={plotWidth + 8}
              y={y(tick) + 4}
              fill={labelColor}
              fontSize={10}
              fontWeight="600"
            >
              {formatValue(tick)}
            </SvgText>
          ))}
          {baseline !== undefined ? (
            <Line
              x1={0}
              x2={plotWidth}
              y1={y(baseline)}
              y2={y(baseline)}
              stroke={labelColor}
              strokeDasharray="2 4"
              strokeWidth={1}
              opacity={0.6}
            />
          ) : null}
          {series.map((item) => {
            if (item.points.length === 0) return null;
            const pts = item.points.map((point) => ({
              x: x(point.t),
              y: y(point.v),
            }));
            const path = linePath(pts);
            const last = pts[pts.length - 1]!;
            const area = single
              ? `${path} L${last.x.toFixed(1)} ${(PAD_TOP + plotHeight).toFixed(1)} L${pts[0]!.x.toFixed(1)} ${(PAD_TOP + plotHeight).toFixed(1)} Z`
              : null;
            return (
              <YStack key={item.key}>
                {area ? (
                  <Path d={area} fill={`url(#area-${item.key})`} />
                ) : null}
                <Path
                  d={path}
                  stroke={item.color}
                  strokeWidth={2}
                  fill="none"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={scrubT === null ? 1 : 0.75}
                />
                <Circle cx={last.x} cy={last.y} r={3.5} fill={item.color} />
                <Circle
                  cx={last.x}
                  cy={last.y}
                  r={7}
                  fill={item.color}
                  opacity={0.18}
                />
              </YStack>
            );
          })}
          {scrubX !== null && scrubT !== null ? (
            <YStack>
              <Line
                x1={scrubX}
                x2={scrubX}
                y1={PAD_TOP}
                y2={PAD_TOP + plotHeight}
                stroke={labelColor}
                strokeWidth={1}
              />
              {series.map((item) => {
                const value = sampleAt(item.points, scrubT);
                if (value === null) return null;
                return (
                  <Circle
                    key={`scrub-${item.key}`}
                    cx={scrubX}
                    cy={y(value)}
                    r={4}
                    fill={item.color}
                    stroke={theme.surface.val}
                    strokeWidth={2}
                  />
                );
              })}
            </YStack>
          ) : null}
          {scrubT === null ? (
            <>
              <SvgText x={0} y={height - 4} fill={labelColor} fontSize={10}>
                {formatTime(domain.t0)}
              </SvgText>
              <SvgText
                x={plotWidth}
                y={height - 4}
                fill={labelColor}
                fontSize={10}
                textAnchor="end"
              >
                {formatTime(domain.t1)}
              </SvgText>
            </>
          ) : (
            <SvgText
              x={Math.min(Math.max(scrubX ?? 0, 36), plotWidth - 36)}
              y={height - 4}
              fill={theme.color.val}
              fontSize={10}
              fontWeight="700"
              textAnchor="middle"
            >
              {formatTime(scrubT)}
            </SvgText>
          )}
        </Svg>
      ) : width > 0 ? (
        <YStack flex={1} alignItems="center" justifyContent="center">
          {empty ?? <Text color="$textMuted" fontSize={12} />}
        </YStack>
      ) : null}
    </View>
  );
}
