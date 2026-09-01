import * as Clipboard from "expo-clipboard";
import { useEffect, useRef } from "react";
import QRCode from "react-native-qrcode-svg";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  AppIcon,
  Body,
  Row,
  SecondaryButton,
  SectionTitle,
  Sheet,
  Stack,
  toast,
  useTheme,
  type SheetHandle,
} from "../../../design-system";
import { useWalletConnectPairing } from "../model/walletconnect-store";

/**
 * WalletConnect 配对：展示二维码给桌面 / 其他设备上的钱包扫，
 * 或直接复制 URI 粘到钱包里。已装的钱包会由连接器直接深链唤起，走不到这里。
 */
export function WalletConnectSheet() {
  const { t } = useFoundationRuntime();
  const theme = useTheme();
  const uri = useWalletConnectPairing((state) => state.uri);
  const dismiss = useWalletConnectPairing((state) => state.dismiss);
  const sheet = useRef<SheetHandle>(null);
  const wasOpen = useRef(false);

  // 只在 open 真正翻转时 present / dismiss（gorhom 的延迟 onDismiss 会打到下一次 present 上）
  useEffect(() => {
    if (uri && !wasOpen.current) {
      wasOpen.current = true;
      sheet.current?.present();
    } else if (!uri && wasOpen.current) {
      wasOpen.current = false;
      sheet.current?.dismiss();
    }
  }, [uri]);

  const copy = async () => {
    if (!uri) return;
    await Clipboard.setStringAsync(uri);
    toast(t("walletconnect.copied"), "success");
  };

  return (
    <Sheet
      ref={sheet}
      title={t("walletconnect.title")}
      subtitle={t("walletconnect.hint")}
      closeLabel={t("common.close")}
      onDismiss={() => {
        wasOpen.current = false;
        dismiss();
      }}
      testID="walletconnect-sheet"
    >
      <Stack gap="$4" alignItems="center">
        {uri ? (
          <Stack
            padding="$3"
            borderRadius="$4"
            backgroundColor="#FFFFFF"
            testID="walletconnect-qr"
          >
            <QRCode value={uri} size={200} />
          </Stack>
        ) : null}
        <Row
          alignItems="center"
          gap="$2"
          padding="$3"
          borderRadius="$4"
          width="100%"
          style={{ backgroundColor: `${theme.warning.val}22` }}
        >
          <AppIcon name="shield-alert-outline" size={18} colorToken="warning" />
          <Body flex={1} fontSize={12} color="$warning">
            {t("walletconnect.warning")}
          </Body>
        </Row>
        <SecondaryButton
          onPress={() => void copy()}
          testID="walletconnect-copy"
          icon={<AppIcon name="content-copy" size={18} />}
        >
          {t("walletconnect.copy")}
        </SecondaryButton>
        <SectionTitle fontSize={12} color="$textMuted">
          {t("walletconnect.waiting")}
        </SectionTitle>
      </Stack>
    </Sheet>
  );
}
