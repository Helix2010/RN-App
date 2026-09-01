import {
  CHAINS,
  type ChainId,
  type TokenRef,
} from "../../../core/gateways/types";
import { formatTokenPrice, splitLeadingZeros } from "../../../core/i18n/format";
import { InlineText, Row, Stack } from "../../../design-system";

export function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    template,
  );
}

const CHAIN_COLORS: Record<ChainId, string> = {
  bsc: "#F0B90B",
  eth: "#627EEA",
  base: "#0052FF",
  "op-sepolia": "#FF0420",
};

/** 代币头像 + 右下角链色小圆标（全局一致的链标识）。 */
export function TokenAvatar({
  token,
  size = 36,
}: {
  token: TokenRef;
  size?: number;
}) {
  return (
    <Stack width={size} height={size}>
      <Stack
        width={size}
        height={size}
        borderRadius={size / 2}
        alignItems="center"
        justifyContent="center"
        style={{ backgroundColor: token.logoColor }}
      >
        <InlineText color="white" fontWeight="900" fontSize={size * 0.4}>
          {token.symbol[0]}
        </InlineText>
      </Stack>
      <Stack
        position="absolute"
        right={-2}
        bottom={-2}
        width={size * 0.4}
        height={size * 0.4}
        borderRadius={size * 0.2}
        borderWidth={2}
        borderColor="$background"
        style={{ backgroundColor: CHAIN_COLORS[token.chain] }}
      />
    </Stack>
  );
}

export function ChainDot({
  chain,
  size = 10,
}: {
  chain: ChainId;
  size?: number;
}) {
  return (
    <Stack
      width={size}
      height={size}
      borderRadius={size / 2}
      style={{ backgroundColor: CHAIN_COLORS[chain] }}
    />
  );
}

export function chainName(chain: ChainId): string {
  return CHAINS[chain].name;
}

/** 价格：前导零折叠显示（$0.0000 1234 → 有效位加大）。 */
export function TokenPrice({
  price,
  locale,
  size = 16,
  big = false,
}: {
  price: string;
  locale: string;
  size?: number;
  big?: boolean;
}) {
  const formatted = formatTokenPrice(price, locale);
  const { head, tail } = splitLeadingZeros(formatted);
  if (!tail) {
    return (
      <InlineText
        fontWeight="800"
        fontSize={size}
        fontVariant={["tabular-nums"]}
      >
        {formatted}
      </InlineText>
    );
  }
  const zeros = head.replace(/^\$0\./, "").length;
  return (
    <Row alignItems="baseline">
      <InlineText
        fontWeight="800"
        fontSize={size}
        fontVariant={["tabular-nums"]}
      >
        $0.0
      </InlineText>
      <InlineText fontWeight="700" fontSize={size * 0.7} color="$textMuted">
        {zeros}
      </InlineText>
      <InlineText
        fontWeight="800"
        fontSize={big ? size * 1.15 : size}
        fontVariant={["tabular-nums"]}
      >
        {tail}
      </InlineText>
    </Row>
  );
}
