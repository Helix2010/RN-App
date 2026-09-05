import { useMemo } from "react";
import { Dimensions } from "react-native";
import { Gesture } from "react-native-gesture-handler";

const EDGE_WIDTH = 32;
const MIN_DISTANCE = 72;
/** 横向先动这么多才接管；竖直先动这么多就让给页面滚动 */
const ACTIVATE_PX = 12;
const FAIL_Y_PX = 16;

export function shouldTriggerEdgeBack({
  startX,
  dx,
  dy,
  width,
}: {
  startX: number;
  dx: number;
  dy: number;
  width: number;
}): boolean {
  const fromLeft = startX <= EDGE_WIDTH;
  const fromRight = startX >= width - EDGE_WIDTH;
  if (!fromLeft && !fromRight) return false;
  if (Math.abs(dy) >= Math.abs(dx)) return false;
  return fromLeft ? dx >= MIN_DISTANCE : dx <= -MIN_DISTANCE;
}

/**
 * 屏幕边缘横滑 = 返回（AppShell 的标签页没有导航栈，系统手势管不到它）。
 * 走 react-native-gesture-handler（交互规范 §0：不再写 PanResponder）：左右各一个只在
 * 32px 边缘区域内能起手的 Pan（`hitSlop`），不从边缘起手的触摸根本不参与，不与页面内的
 * 横向滚动 / 图表刻度手势抢；竖直先动就让给页面滚动。Android 手势导航下系统会先吃掉
 * 边缘滑动并发 `hardwareBackPress`，本手势自然不触发；它服务的是三键导航的 Android 与 iOS。
 */
export function useEdgeBackGesture(onBack: () => void) {
  const width = Dimensions.get("window").width;
  return useMemo(() => {
    const edge = (side: "left" | "right") =>
      Gesture.Pan()
        .runOnJS(true)
        .hitSlop(
          side === "left"
            ? { left: 0, width: EDGE_WIDTH }
            : { right: 0, width: EDGE_WIDTH },
        )
        .activeOffsetX([-ACTIVATE_PX, ACTIVATE_PX])
        .failOffsetY([-FAIL_Y_PX, FAIL_Y_PX])
        .onEnd((event) => {
          if (
            shouldTriggerEdgeBack({
              startX: event.x - event.translationX,
              dx: event.translationX,
              dy: event.translationY,
              width,
            })
          )
            onBack();
        });
    return Gesture.Race(edge("left"), edge("right"));
  }, [onBack, width]);
}
