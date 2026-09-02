import { useFoundationRuntime } from "../../../app/runtime-context";
import { CHAINS } from "../../../core/gateways/types";
import { fill } from "../../../core/i18n/format";
import {
  AppIcon,
  InlineText,
  Row,
  Stack,
  useTheme,
} from "../../../design-system";
import type { ChainBalanceFailure } from "../model/wallet";

/**
 * 某几条链的余额这次没拿到。一条一行、点名是哪条链、为什么；其他链的余额照常显示在
 * 它下面——整批报错会让一条链的故障把用户所有资产都遮住。
 */
export function ChainUnavailableNotice({
  failures,
  onRetry,
}: {
  failures: ChainBalanceFailure[];
  onRetry?: () => void;
}) {
  const { t } = useFoundationRuntime();
  const theme = useTheme();
  if (failures.length === 0) return null;
  return (
    <Stack gap="$2" testID="chain-unavailable-notice">
      {failures.map((failure) => (
        <Row
          key={failure.chain}
          alignItems="center"
          gap="$2"
          padding="$3"
          borderRadius="$4"
          style={{ backgroundColor: `${theme.warning.val}22` }}
          testID={`chain-unavailable-${failure.chain}`}
        >
          <AppIcon name="alert-outline" size={18} colorToken="warning" />
          <InlineText flex={1} fontSize={12} color="$warning" fontWeight="600">
            {fill(t(`assets.balanceUnavailable.${failure.reason}`), {
              chain: CHAINS[failure.chain].name,
            })}
          </InlineText>
          {onRetry ? (
            <Stack
              onPress={onRetry}
              padding="$1.5"
              borderRadius={999}
              accessibilityRole="button"
              accessibilityLabel={t("assets.balanceUnavailable.retry")}
              testID={`chain-unavailable-retry-${failure.chain}`}
            >
              <AppIcon name="refresh" size={18} colorToken="warning" />
            </Stack>
          ) : null}
        </Row>
      ))}
    </Stack>
  );
}
