import * as Clipboard from "expo-clipboard";
import { forwardRef, useState } from "react";
import { Share } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { CHAINS, type ChainId } from "../../../core/gateways/types";
import {
  AppIcon,
  Body,
  InlineText,
  Row,
  SecondaryButton,
  SectionTitle,
  SegmentedControl,
  Sheet,
  Stack,
  toast,
  type SheetHandle,
  useTheme,
} from "../../../design-system";

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, value),
    template,
  );
}

/** A-04 收款：链 chip 只改提示文案，二维码内容为纯地址。 */
export const ReceiveSheet = forwardRef<
  SheetHandle,
  { address: string; ens?: string; chains: ChainId[] }
>(function ReceiveSheet({ address, ens, chains }, ref) {
  const { t } = useFoundationRuntime();
  const theme = useTheme();
  const [chain, setChain] = useState<ChainId>(chains[0] ?? "bsc");
  const chainName = CHAINS[chain].name;
  const tokens =
    chain === "bsc"
      ? "BNB、USDT、USDC"
      : chain === "eth"
        ? "ETH、USDC、UNI"
        : "ETH、AERO";

  const copy = async () => {
    await Clipboard.setStringAsync(address);
    toast(t("receive.copied"), "success");
  };

  return (
    <Sheet
      ref={ref}
      title={t("receive.title")}
      closeLabel={t("common.close")}
      scroll
      testID="receive-sheet"
    >
      <SegmentedControl
        value={chain}
        options={chains.map((id) => ({ value: id, label: CHAINS[id].name }))}
        onChange={setChain}
        accessibilityLabel={t("send.network")}
      />
      <Stack alignItems="center" gap="$3" paddingVertical="$2">
        <Stack padding="$3" borderRadius="$4" backgroundColor="white">
          <QRCode
            value={address}
            size={196}
            backgroundColor="white"
            color="#0B1220"
          />
        </Stack>
        {ens ? <SectionTitle>{ens}</SectionTitle> : null}
        <Body textAlign="center" fontSize={12} selectable>
          {address}
        </Body>
      </Stack>
      <Row gap="$2">
        <SecondaryButton
          flex={1}
          onPress={() => void copy()}
          testID="receive-copy"
          icon={<AppIcon name="content-copy" size={18} />}
        >
          {t("receive.copy")}
        </SecondaryButton>
        <SecondaryButton
          flex={1}
          onPress={() => void Share.share({ message: address })}
          testID="receive-share"
          icon={<AppIcon name="share-variant-outline" size={18} />}
        >
          {t("receive.share")}
        </SecondaryButton>
      </Row>
      <Row
        alignItems="flex-start"
        gap="$2"
        padding="$3"
        borderRadius="$4"
        style={{ backgroundColor: `${theme.warning.val}22` }}
      >
        <AppIcon name="alert-outline" size={18} colorToken="warning" />
        <InlineText flex={1} fontSize={12} color="$warning" fontWeight="600">
          {fill(t("receive.warn"), { chain: chainName })}
        </InlineText>
      </Row>
      <Body fontSize={12}>
        {fill(fill(t("receive.support"), { chain: chainName }), { tokens })}
      </Body>
    </Sheet>
  );
});
