import * as Clipboard from "expo-clipboard";
import { fill } from "../../../core/i18n/format";
import { forwardRef, useState } from "react";
import { Share } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { CHAINS, type ChainId } from "../../../core/gateways/types";
import {
  deliveredTokens,
  enabledChains,
  isChainEnabled,
  isTestnetChain,
} from "../../../core/wallet/config/wallet-runtime-config";
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

/**
 * A-04 收款：链 chip 只改提示文案，二维码内容为纯地址。
 *
 * 能选的链 = 账户支持的链 ∩ 租户启用的链；账户一条都对不上时退到租户启用的链
 * （EVM 地址在每条链上都一样，所以收款本身不受影响）。"支持的币种"读服务端下发的
 * 代币目录——它就是这条链上 App 会显示余额的那些币；老服务端没下发时只提原生币。
 */
export const ReceiveSheet = forwardRef<
  SheetHandle,
  { address: string; ens?: string; chains: ChainId[] }
>(function ReceiveSheet({ address, ens, chains }, ref) {
  const { t } = useFoundationRuntime();
  const theme = useTheme();
  const supported = chains.filter(isChainEnabled);
  const options = supported.length > 0 ? supported : enabledChains();
  const [chain, setChain] = useState<ChainId>(options[0] ?? "bsc");
  const chainName = CHAINS[chain].name;
  const testnet = isTestnetChain(chain);
  const symbols = deliveredTokens(chain).map((token) => token.symbol);
  const tokens = (
    symbols.length > 0 ? symbols : [CHAINS[chain].nativeSymbol]
  ).join(t("receive.tokenSeparator"));

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
        options={options.map((id) => ({
          value: id,
          // 测试链必须标出来：主网资产打到测试链地址，虽同地址却在错的链上
          label: isTestnetChain(id)
            ? `${CHAINS[id].name} · ${t("send.testnetTag")}`
            : CHAINS[id].name,
        }))}
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
      {testnet ? (
        <Body fontSize={12} color="$warning" testID="receive-testnet-notice">
          {t("receive.testnetNotice")}
        </Body>
      ) : null}
      <Body fontSize={12}>
        {fill(fill(t("receive.support"), { chain: chainName }), { tokens })}
      </Body>
    </Sheet>
  );
});
