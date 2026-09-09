import { useEffect, useState } from "react";
import { Animated, Image } from "react-native";
import type { BrandingAsset } from "../core/config/bootstrap.schema";
import { brandingAssetUrl } from "../core/config/branding-assets";
import { Body, Page, Spinner, Stack } from "../design-system";

/**
 * 启动页：**严格按服务端下发的品牌配置画**，配置里有什么画什么。
 *
 * - `pending`：还不知道本次该用哪版品牌（缓存还没读完），只画主题背景与一句状态文案；
 * - 配置里没有 logo / 背景图就不画，没有"内置几何标"这种替身——先画替身再换成
 *   租户 logo，用户看到的就是启动图加载了两次；
 * - 配置的图片加载失败只留痕，不换别的图；
 * - 背景图与 logo 二选一：背景图可用时只画背景图，否则画 logo + 标题（见 backgroundVisible）。
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
  const [opacity] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(1));
  const [logoFailedId, setLogoFailedId] = useState<string | null>(null);
  const [backgroundFailedId, setBackgroundFailedId] = useState<string | null>(
    null,
  );
  const [backgroundLoadedId, setBackgroundLoadedId] = useState<string | null>(
    null,
  );
  // 背景图和 logo 二选一：背景图已在本地（缓存过）或刚加载完就只画背景图；
  // 还没下完、或加载失败，就画 logo + 标题。两个叠着画曾经出现过 logo 盖在背景图上。
  const backgroundUsable =
    backgroundImage !== undefined &&
    backgroundFailedId !== backgroundImage.assetId;
  const backgroundVisible =
    backgroundUsable &&
    (Boolean(backgroundImage.localFileUrl) ||
      backgroundLoadedId === backgroundImage.assetId);

  useEffect(() => {
    if (pending) return;
    // 首帧还不知道品牌配置（pending），Animated.Value 的初值不能按 props 给：
    // 这里按真正下发的动画类型重设起点，再起动画
    if (animationType === "none") {
      opacity.setValue(1);
      scale.setValue(1);
      return;
    }
    opacity.setValue(0);
    scale.setValue(animationType === "fade_scale" ? 0.86 : 1);
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
        <Stack alignItems="center" gap="$3" testID="launch-pending">
          <Spinner size="large" color="$primary" />
          <Body fontSize={13}>{message}</Body>
        </Stack>
      </Page>
    );

  return (
    <Page
      alignItems="center"
      justifyContent="center"
      backgroundColor={backgroundColor as never}
      testID="launch-screen"
    >
      {backgroundUsable ? (
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
            opacity: backgroundVisible ? 1 : 0,
          }}
          onLoad={() => setBackgroundLoadedId(backgroundImage.assetId)}
          testID="launch-background"
          onError={() => {
            console.warn(
              `[launch] 启动页背景图加载失败：${backgroundImage.assetId}`,
            );
            setBackgroundFailedId(backgroundImage.assetId);
          }}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <Animated.View
        style={{ opacity, transform: [{ scale }] }}
        testID="launch-content"
      >
        <Stack alignItems="center" gap="$4">
          {!backgroundVisible && logo && logoFailedId !== logo.assetId ? (
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
            {!backgroundVisible ? (
              <Body fontSize={18} color="$color" fontWeight="800">
                {title}
              </Body>
            ) : null}
            <Body fontSize={13}>{message}</Body>
          </Stack>
        </Stack>
      </Animated.View>
    </Page>
  );
}
