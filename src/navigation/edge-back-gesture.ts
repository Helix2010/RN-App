import { useMemo } from "react";
import { Dimensions, PanResponder } from "react-native";

const EDGE_WIDTH = 32;
const MIN_DISTANCE = 72;

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

export function useEdgeBackGesture(onBack: () => void) {
  const width = Dimensions.get("window").width;
  return useMemo(() => {
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, gesture) => {
        const fromEdge =
          gesture.x0 <= EDGE_WIDTH || gesture.x0 >= width - EDGE_WIDTH;
        return (
          fromEdge &&
          Math.abs(gesture.dx) > 12 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy)
        );
      },
      onPanResponderRelease: (_, gesture) => {
        if (
          shouldTriggerEdgeBack({
            startX: gesture.x0,
            dx: gesture.dx,
            dy: gesture.dy,
            width,
          })
        ) {
          onBack();
        }
      },
    }).panHandlers;
  }, [onBack, width]);
}
