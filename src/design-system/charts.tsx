import { useState } from "react";
import { type LayoutChangeEvent } from "react-native";
import Svg, {
  Defs,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import { YStack, useTheme } from "tamagui";

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

/** 面积折线图（预测价格 / 盈亏），宽度自适应容器；`baseline` 画虚线基准。 */
export function AreaChart({
  values,
  height = 160,
  tone = "primary",
  baseline,
  onLayoutWidth,
}: {
  values: number[];
  height?: number;
  tone?: "primary" | "positive" | "negative";
  baseline?: number;
  onLayoutWidth?: (width: number) => void;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const color =
    tone === "positive"
      ? theme.pricePositive.val
      : tone === "negative"
        ? theme.priceNegative.val
        : theme.primary.val;
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth(next);
    onLayoutWidth?.(next);
  };
  const points =
    width > 0 && values.length > 1 ? scale(values, width, height, 6) : [];
  const path = linePath(points);
  const area = points.length
    ? `${path} L${width} ${height} L0 ${height} Z`
    : "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const baselineY =
    baseline !== undefined && max !== min
      ? 6 + (1 - (baseline - min) / (max - min)) * (height - 12)
      : undefined;
  return (
    <YStack height={height} onLayout={onLayout} accessibilityRole="image">
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.28} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {area ? <Path d={area} fill="url(#area)" /> : null}
          {baselineY !== undefined ? (
            <Line
              x1={0}
              x2={width}
              y1={baselineY}
              y2={baselineY}
              stroke={theme.borderColor.val}
              strokeDasharray="4 4"
            />
          ) : null}
          {path ? (
            <Path
              d={path}
              stroke={color}
              strokeWidth={2}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
        </Svg>
      ) : null}
    </YStack>
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
