import { useEffect, useState } from "react";
import { Animated, Image } from "react-native";
import type { BrandingAsset } from "../core/config/bootstrap.schema";
import { brandingAssetUrl } from "../core/config/branding-assets";
import { Body, Page, Stack } from "../design-system";

/**
 * 启动页：**严格按服务端下发的品牌配置画**，配置里有什么画什么。
 *
 * - `pending`：还不知道本次该用哪版品牌（缓存还没读完），只画背景与一句状态文案；
 * - 配置里没有 logo / 背景图就不画，没有"内置几何标"这种替身——先画替身再换成
 *   租户 logo，用户看到的就是启动图加载了两次；
 * - 配置的图片加载失败只留痕，不换别的图。
 */
export function LaunchScreen({
  pending = false,
  message,
  title,
  logo,
  backgroundImage,
  backgroundColor,
  animationType = "fade_scale",
  animationDurationMs = 360,
}: {
  pending?: boolean;
  message: string;
  title: string;
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
  const [logoFailedId, setLogoFailedId] = useState<string | null>(null);
  const [backgroundFailedId, setBackgroundFailedId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (pending || animationType === "none") return;
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
  }, [animationDurationMs, animationType, opacity, pending, scale]);

  if (pending)
    return (
      <Page
        alignItems="center"
        justifyContent="center"
        testID="launch-screen"
        accessibilityLabel={message}
      >
        <Body fontSize={13} testID="launch-pending">
          {message}
        </Body>
      </Page>
    );

  return (
    <Page
      alignItems="center"
      justifyContent="center"
      backgroundColor={backgroundColor as never}
      testID="launch-screen"
    >
      {backgroundImage && backgroundFailedId !== backgroundImage.assetId ? (
        <Image
          source={{
            uri:
              backgroundImage.localFileUrl ?? brandingAssetUrl(backgroundImage),
          }}
          resizeMode="cover"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
          onError={() => {
            console.warn(
              `[launch] 启动页背景图加载失败：${backgroundImage.assetId}`,
            );
            setBackgroundFailedId(backgroundImage.assetId);
          }}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        <Stack alignItems="center" gap="$4">
          {logo && logoFailedId !== logo.assetId ? (
            <Image
              source={{ uri: logo.localFileUrl ?? brandingAssetUrl(logo) }}
              resizeMode="contain"
              style={{ width: 104, height: 104 }}
              onError={() => {
                console.warn(`[launch] 启动页 logo 加载失败：${logo.assetId}`);
                setLogoFailedId(logo.assetId);
              }}
              accessibilityLabel={title}
              testID="launch-logo"
            />
          ) : null}
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
