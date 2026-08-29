import { useEffect, useState } from "react";
import { Animated, Image } from "react-native";
import type { BrandingAsset } from "../core/config/bootstrap.schema";
import { BrandMark, Body, Page, Stack } from "../design-system";

export function LaunchScreen({
  message,
  title = "AnyFun",
  logo,
  backgroundImage,
  backgroundColor,
  animationType = "fade_scale",
  animationDurationMs = 360,
}: {
  message: string;
  title?: string;
  logo?: BrandingAsset & { localFileUrl?: string };
  backgroundImage?: BrandingAsset & { localFileUrl?: string };
  backgroundColor?: string;
  animationType?: "fade_scale" | "fade" | "none";
  animationDurationMs?: number;
}) {
  const [opacity] = useState(
    () => new Animated.Value(animationType === "none" ? 1 : 0),
  );
  const [scale] = useState(
    () => new Animated.Value(animationType === "fade_scale" ? 0.86 : 1),
  );

  useEffect(() => {
    if (animationType === "none") return;
    const fade = Animated.timing(opacity, {
      toValue: 1,
      duration: animationDurationMs,
      useNativeDriver: true,
    });
    const grow =
      animationType === "fade_scale"
        ? Animated.spring(scale, {
            toValue: 1,
            damping: 16,
            stiffness: 180,
            mass: 0.8,
            useNativeDriver: true,
          })
        : Animated.delay(0);
    Animated.parallel([fade, grow]).start();
  }, [animationDurationMs, animationType, opacity, scale]);

  return (
    <Page
      alignItems="center"
      justifyContent="center"
      backgroundColor={backgroundColor as never}
    >
      {backgroundImage?.localFileUrl ? (
        <Image
          source={{ uri: backgroundImage.localFileUrl }}
          resizeMode="cover"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0.22,
          }}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        <Stack alignItems="center" gap="$4">
          {logo?.localFileUrl ? (
            <Image
              source={{ uri: logo.localFileUrl }}
              style={{ width: 88, height: 88, borderRadius: 22 }}
              accessibilityLabel={title}
            />
          ) : (
            <BrandMark size={88} />
          )}
          <Stack alignItems="center" gap="$1">
            <Body fontSize={18} color="$color" fontWeight="800">
              {title}
            </Body>
            <Body fontSize={13}>{message}</Body>
          </Stack>
        </Stack>
      </Animated.View>
    </Page>
  );
}
