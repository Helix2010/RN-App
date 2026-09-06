import * as Clipboard from "expo-clipboard";
import { fill, formatTokenAmount } from "../../../core/i18n/format";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Share } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { CHAINS, type ChainId } from "../../../core/gateways/types";
import {
  deliveredTokens,
  isChainEnabled,
  isTestnetChain,
} from "../../../core/wallet/config/wallet-runtime-config";
import { useIncomingTransferWatch } from "../../wallet/hooks/use-wallet";
import {
  AppIcon,
  Body,
  InlineText,
  Row,
  SecondaryButton,
  SectionTitle,
  ChipRow,
  Sheet,
  Stack,
  toast,
  type SheetHandle,
  useTheme,
} from "../../../design-system";

/**
 * A-04 收款：链 chip 只改提示文案，二维码内容为纯地址。
 *
 * 能选的链 = 账户支持的链 ∩ 租户启用的链，一条都没有就如实说明、不显示地址。
 * "支持的币种"读服务端下发的代币目录——它就是这条链上 App 会显示余额的那些币。
 * 打开期间每 15 秒查一次平台收款索引，新入账即 toast 并刷新余额。
 */
export const ReceiveSheet = forwardRef<
  SheetHandle,
  { address: string; ens?: string; chains: ChainId[] }
>(function ReceiveSheet({ address, ens, chains }, ref) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const theme = useTheme();
  const options = chains.filter(isChainEnabled);
  const [picked, setPicked] = useState<ChainId | undefined>(options[0]);
  // 可选项会随配置刷新变化：选中的链不在里面就回到第一项，一项都没有就是空态
  const chain = picked && options.includes(picked) ? picked : options[0];
  // 只在收款页开着时轮询：用 ref 包一层拿到 present / dismiss 的时机
  const sheet = useRef<SheetHandle>(null);
  const [open, setOpen] = useState(false);
  useImperativeHandle(
    ref,
    () => ({
      present: () => {
        setOpen(true);
        sheet.current?.present();
      },
      dismiss: () => {
        setOpen(false);
        sheet.current?.dismiss();
      },
    }),
    [],
  );
  useIncomingTransferWatch(address, open, (transfer) =>
    toast(
      fill(t("receive.arrived"), {
        amount: formatTokenAmount(
          transfer.amount,
          transfer.token.displayDecimals,
          locale,
        ),
        symbol: transfer.token.symbol,
      }),
      "success",
    ),
  );

  const copy = async () => {
    await Clipboard.setStringAsync(address);
    toast(t("receive.copied"), "success");
  };

  if (chain === undefined)
    return (
      <Sheet
        ref={sheet}
        onDismiss={() => setOpen(false)}
        title={t("receive.title")}
        closeLabel={t("common.close")}
        testID="receive-sheet"
      >
        <Body fontSize={12} testID="receive-no-chain">
          {t("receive.noChain")}
        </Body>
      </Sheet>
    );

  const chainName = CHAINS[chain].name;
  const testnet = isTestnetChain(chain);
  const tokens = deliveredTokens(chain)
    .map((token) => token.symbol)
    .join(t("receive.tokenSeparator"));

  return (
    <Sheet
      ref={sheet}
      onDismiss={() => setOpen(false)}
      title={t("receive.title")}
      closeLabel={t("common.close")}
      scroll
      testID="receive-sheet"
    >
      <ChipRow
        value={chain}
        options={options.map((id) => ({
          value: id,
          label: CHAINS[id].shortName,
          color: CHAINS[id].color,
          // 测试链必须标出来：主网资产打到测试链地址，虽同地址却在错的链上
          tag: isTestnetChain(id) ? t("send.testnetTag") : undefined,
        }))}
        onChange={setPicked}
        accessibilityLabel={t("send.network")}
        testID="receive-chain"
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
