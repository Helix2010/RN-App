/**
 * 轻量 Reanimated 替身：官方 mock 仍会加载 react-native-worklets 的原生模块，
 * 这里只实现本项目用到的 API（Animated.View / useSharedValue / useAnimatedStyle /
 * withTiming / FadeInUp / FadeOutUp），动画在测试里退化为静态渲染。
 */
import { View as RNView, type ViewProps } from "react-native";

type SharedValue<T> = { value: T };

const entering = { duration: () => entering, delay: () => entering };

export const View = (props: ViewProps) => <RNView {...props} />;
export const Text = RNView;
export const ScrollView = RNView;
export const createAnimatedComponent = <P,>(component: P) => component;

export const useSharedValue = <T,>(initial: T): SharedValue<T> => ({
  value: initial,
});
export const useAnimatedStyle = (factory: () => object) => factory();
export const useAnimatedScrollHandler = (handlers: unknown) => handlers;
/** 静态渲染：直接给出输出区间的首值，够断言布局，不做插值 */
export const interpolate = (
  _value: number,
  _input: readonly number[],
  output: readonly number[],
) => output[0] ?? 0;
export const Extrapolation = { CLAMP: "clamp", EXTEND: "extend" } as const;
export const useDerivedValue = <T,>(factory: () => T): SharedValue<T> => ({
  value: factory(),
});
export const withTiming = <T,>(value: T) => value;
export const withSpring = <T,>(value: T) => value;
export const withDelay = <T,>(_delay: number, value: T) => value;
export const runOnJS =
  <A extends unknown[]>(fn: (...args: A) => void) =>
  (...args: A) =>
    fn(...args);
export const Easing = { linear: () => 0, ease: () => 0, inOut: () => 0 };
export const FadeInUp = entering;
export const FadeOutUp = entering;
export const FadeIn = entering;
export const FadeOut = entering;

const Animated = { View, Text, ScrollView, createAnimatedComponent };
export default Animated;
