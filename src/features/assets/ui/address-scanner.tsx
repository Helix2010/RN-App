import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { Linking, Modal, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  AppIcon,
  Body,
  InlineText,
  PrimaryButton,
  Row,
  SecondaryButton,
  SectionTitle,
  Stack,
} from "../../../design-system";

/** 扫到一个不是地址的码之后，多久恢复扫描 */
const REJECT_COOLDOWN_MS = 1500;

/**
 * 收款地址扫码：全屏相机 + 取景框。
 *
 * 只认 QR；内容交给调用方判断（`onScanned` 返回 false 表示不是地址），这里只负责
 * "一次只报一个码"和"被拒后停一下再扫"，否则同一个码每帧都会触发。
 * 权限：打开时请求一次；用户拒绝且系统不再允许询问时，给"去设置"入口，不假装能扫。
 */
export function AddressScanner({
  visible,
  onClose,
  onScanned,
}: {
  visible: boolean;
  onClose: () => void;
  /** 返回 true 表示已接受并会关闭扫码；false 表示码里不是地址，继续扫 */
  onScanned: (data: string) => boolean;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* 主体只在可见时挂载：关掉再打开就是一次全新的扫描（手电筒、拒绝提示都复位） */}
      {visible ? <ScannerBody onClose={onClose} onScanned={onScanned} /> : null}
    </Modal>
  );
}

function ScannerBody({
  onClose,
  onScanned,
}: {
  onClose: () => void;
  onScanned: (data: string) => boolean;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [rejected, setRejected] = useState(false);
  const busy = useRef(false);
  const cooldown = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asked = useRef(false);

  // 一次挂载只弹一次系统授权框。Android 上"拒绝一次"之后 canAskAgain 仍是 true，
  // 跟着 permission 变化重新请求会把用户按在弹框里反复点
  useEffect(() => {
    if (asked.current || !permission) return;
    if (permission.granted || !permission.canAskAgain) return;
    asked.current = true;
    void requestPermission();
  }, [permission, requestPermission]);

  useEffect(
    () => () => {
      if (cooldown.current) clearTimeout(cooldown.current);
    },
    [],
  );

  const handle = (result: BarcodeScanningResult) => {
    if (busy.current) return;
    busy.current = true;
    if (onScanned(result.data)) return;
    setRejected(true);
    cooldown.current = setTimeout(() => {
      busy.current = false;
      setRejected(false);
    }, REJECT_COOLDOWN_MS);
  };

  const denied = permission !== null && !permission.granted;

  return (
    <View style={styles.root} testID="address-scanner">
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={handle}
          testID="address-scanner-camera"
        />
      ) : null}
      <View
        style={[styles.overlay, { paddingTop: insets.top + 8 }]}
        pointerEvents="box-none"
      >
        <Row alignItems="center" paddingHorizontal="$3" gap="$3">
          <Stack
            onPress={onClose}
            padding="$2"
            accessibilityRole="button"
            accessibilityLabel={t("action.back")}
            testID="address-scanner-close"
          >
            <AppIcon name="close" size={26} colorToken="onPrimary" />
          </Stack>
          <SectionTitle flex={1} color="white" fontSize={17}>
            {t("send.scanTitle")}
          </SectionTitle>
          {permission?.granted ? (
            <Stack
              onPress={() => setTorch((on) => !on)}
              padding="$2"
              accessibilityRole="button"
              accessibilityLabel={t("send.scanTorch")}
              accessibilityState={{ selected: torch }}
            >
              <AppIcon
                name={torch ? "flashlight-off" : "flashlight"}
                size={24}
                colorToken="onPrimary"
              />
            </Stack>
          ) : null}
        </Row>
        <View style={styles.center} pointerEvents="none">
          <View style={styles.frame}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>
          <InlineText
            color="white"
            fontSize={14}
            textAlign="center"
            marginTop="$4"
            paddingHorizontal="$6"
            testID="address-scanner-hint"
          >
            {rejected ? t("send.scanNotAddress") : t("send.scanHint")}
          </InlineText>
        </View>
        {denied ? (
          <Stack
            margin="$4"
            marginBottom={insets.bottom + 16}
            padding="$4"
            gap="$3"
            borderRadius="$4"
            backgroundColor="$surface"
            testID="address-scanner-denied"
          >
            <SectionTitle fontSize={16}>
              {t("send.scanPermissionTitle")}
            </SectionTitle>
            <Body fontSize={13}>{t("send.scanPermissionBody")}</Body>
            <Row gap="$2">
              <SecondaryButton flex={1} onPress={onClose}>
                {t("common.cancel")}
              </SecondaryButton>
              <PrimaryButton
                flex={1}
                onPress={() => void Linking.openSettings()}
              >
                {t("send.scanOpenSettings")}
              </PrimaryButton>
            </Row>
          </Stack>
        ) : (
          <View style={{ height: insets.bottom + 16 }} />
        )}
      </View>
    </View>
  );
}

const FRAME = 240;
const CORNER = 28;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  overlay: { flex: 1, justifyContent: "space-between" },
  center: { alignItems: "center", justifyContent: "center" },
  frame: { width: FRAME, height: FRAME },
  corner: {
    position: "absolute",
    width: CORNER,
    height: CORNER,
    borderColor: "#FFFFFF",
  },
  topLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  topRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
});
