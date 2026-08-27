import { useEffect, useState } from "react";
import { Animated } from "react-native";
import { BrandMark, Body, Page, Stack } from "../design-system";

export function LaunchScreen({ message }: { message: string }) {
  const [opacity] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(0.86));

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 360,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        damping: 16,
        stiffness: 180,
        mass: 0.8,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale]);

  return (
    <Page alignItems="center" justifyContent="center">
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        <Stack alignItems="center" gap="$4">
          <BrandMark size={88} />
          <Stack alignItems="center" gap="$1">
            <Body fontSize={18} color="$color" fontWeight="800">
              AnyFun
            </Body>
            <Body fontSize={13}>{message}</Body>
          </Stack>
        </Stack>
      </Animated.View>
    </Page>
  );
}
