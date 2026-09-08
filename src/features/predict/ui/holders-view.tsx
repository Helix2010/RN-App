import { useFoundationRuntime } from "../../../app/runtime-context";
import { shortenAddress } from "../../../core/i18n/format";
import {
  Body,
  InlineText,
  Row,
  SectionTitle,
  SkeletonBlock,
  Stack,
} from "../../../design-system";
import { useHolders } from "../hooks/use-predict";
import type { HolderGroup } from "../model/predict";
import { fill } from "./shared";

/** 详情页"持有者"页签：data-service 的持有人榜，Yes / No 两列各取前 10 */
export function HoldersView({ marketId }: { marketId: string }) {
  const { t } = useFoundationRuntime();
  const holders = useHolders(marketId);
  if (holders.isError)
    return (
      <Body color="$danger">
        {holders.error instanceof Error
          ? holders.error.message
          : String(holders.error)}
      </Body>
    );
  if (!holders.data) return <SkeletonBlock height={120} />;
  const groups = holders.data.filter((group) => group.holders.length > 0);
  if (groups.length === 0) return <Body>{t("predict.holders.empty")}</Body>;
  return (
    <Row gap="$3" alignItems="flex-start" testID="detail-holders">
      {holders.data.map((group) => (
        <HolderColumn key={group.outcome} group={group} />
      ))}
    </Row>
  );
}

function HolderColumn({ group }: { group: HolderGroup }) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  return (
    <Stack flex={1} gap="$1.5">
      <SectionTitle
        fontSize={13}
        color={group.outcome === "yes" ? "$success" : "$danger"}
      >
        {t(
          group.outcome === "yes"
            ? "predict.holders.yes"
            : "predict.holders.no",
        )}
      </SectionTitle>
      {group.holders.length === 0 ? (
        <Body fontSize={12}>{t("predict.holders.empty")}</Body>
      ) : (
        group.holders.map((holder, index) => (
          <Row
            key={`${holder.address}-${index}`}
            alignItems="center"
            gap="$2"
            paddingVertical="$1"
          >
            <Body fontSize={11} width={16}>
              {index + 1}
            </Body>
            <Stack flex={1}>
              <InlineText fontSize={12} fontWeight="700" numberOfLines={1}>
                {holder.name ?? t("predict.holders.anonymous")}
              </InlineText>
              <Body fontSize={10}>{shortenAddress(holder.address)}</Body>
            </Stack>
            <Body fontSize={11}>
              {fill(t("predict.holders.shares"), {
                n: Math.round(holder.shares).toLocaleString(locale),
              })}
            </Body>
          </Row>
        ))
      )}
    </Stack>
  );
}
