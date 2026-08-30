import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { CHAINS, type ChainId } from "../../../core/gateways/types";
import {
  formatDate,
  formatMoney,
  shortenAddress,
} from "../../../core/i18n/format";
import { mockNow } from "../../../core/mock/mock-runtime";
import {
  Body,
  Content,
  InlineText,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  SegmentedControl,
  SkeletonBlock,
  Stack,
  toast,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import { useApprovals, useRevoke } from "../hooks/use-dex";
import type { Approval } from "../model/dex";
import { TokenAvatar, fill } from "./shared";

/** D-06 代币授权管理：额度（无限 warn pill）、被授权合约、授权时间 / 最近使用（> 30 天 warn）、撤销、一键撤销无限额度。 */
export function ApprovalsScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const session = useSession();
  const address = session.data?.address;
  const [chain, setChain] = useState<ChainId | "all">("all");
  const approvals = useApprovals(address, chain === "all" ? undefined : chain);
  const revoke = useRevoke(address);
  const unlimited = (approvals.data ?? []).filter(
    (item) => item.allowance === null,
  );

  const revokeOne = (item: Approval) =>
    revoke.mutate(item.id, {
      onSuccess: () => toast(t("approvals.revoked"), "success"),
      onError: () => toast(t("state.error"), "error"),
    });
  const revokeAll = async () => {
    for (const item of unlimited) await revoke.mutateAsync(item.id);
    toast(t("approvals.revoked"), "success");
  };

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("approvals.title")}
          onBack={onBack}
          backLabel={t("action.back")}
        />
      </Content>
      <PageScroll>
        <Content paddingTop="$1" gap="$3" paddingBottom={120}>
          <Body fontSize={12}>{t("approvals.hint")}</Body>
          <SegmentedControl
            value={chain}
            options={[
              { value: "all" as const, label: t("dex.allChains") },
              ...(Object.keys(CHAINS) as ChainId[]).map((id) => ({
                value: id,
                label: CHAINS[id].name,
              })),
            ]}
            onChange={setChain}
            accessibilityLabel={t("send.network")}
          />
          {approvals.data ? (
            approvals.data.length === 0 ? (
              <Body>{t("approvals.empty")}</Body>
            ) : (
              approvals.data.map((item) => {
                const unusedDays = item.lastUsedAt
                  ? Math.floor(
                      (mockNow() - new Date(item.lastUsedAt).getTime()) /
                        86_400_000,
                    )
                  : Math.floor(
                      (mockNow() - new Date(item.approvedAt).getTime()) /
                        86_400_000,
                    );
                const stale = unusedDays > 30;
                return (
                  <Row
                    key={item.id}
                    alignItems="center"
                    gap="$3"
                    paddingVertical="$2.5"
                    borderBottomWidth={1}
                    borderColor="$borderColor"
                    testID={`approval-${item.id}`}
                  >
                    <TokenAvatar token={item.token} size={36} />
                    <Stack flex={1} gap="$0.5">
                      <Row alignItems="center" gap="$2">
                        <SectionTitle fontSize={15}>
                          {item.token.symbol}
                        </SectionTitle>
                        {item.allowance === null ? (
                          <Stack
                            paddingHorizontal={6}
                            paddingVertical={2}
                            borderRadius={4}
                            backgroundColor="$warning"
                          >
                            <InlineText
                              fontSize={10}
                              fontWeight="800"
                              color="$onPrimary"
                            >
                              {t("approvals.unlimited")}
                            </InlineText>
                          </Stack>
                        ) : (
                          <Body fontSize={12}>
                            {formatMoney(item.allowance, locale)}
                          </Body>
                        )}
                      </Row>
                      <Body fontSize={12}>
                        {item.spender.name} ·{" "}
                        {shortenAddress(item.spender.address, 6, 4)}
                      </Body>
                      <Body
                        fontSize={11}
                        color={stale ? "$warning" : "$textMuted"}
                      >
                        {fill(t("approvals.approvedAt"), {
                          date: formatDate(item.approvedAt, locale),
                        })}{" "}
                        ·{" "}
                        {stale
                          ? fill(t("approvals.unusedDays"), { n: unusedDays })
                          : fill(t("approvals.lastUsed"), {
                              when: item.lastUsedAt
                                ? formatDate(item.lastUsedAt, locale)
                                : formatDate(item.approvedAt, locale),
                            })}
                      </Body>
                    </Stack>
                    <SecondaryButton
                      height={32}
                      paddingHorizontal="$3"
                      fontSize={12}
                      disabled={revoke.isPending}
                      onPress={() => revokeOne(item)}
                      testID={`revoke-${item.id}`}
                    >
                      {t("approvals.revoke")}
                    </SecondaryButton>
                  </Row>
                );
              })
            )
          ) : (
            <Stack gap="$2">
              <SkeletonBlock height={64} />
              <SkeletonBlock height={64} />
            </Stack>
          )}
        </Content>
      </PageScroll>
      {unlimited.length > 0 ? (
        <Stack
          position="absolute"
          left={0}
          right={0}
          bottom={0}
          padding="$4"
          paddingBottom={insets.bottom + 12}
          backgroundColor="$background"
          borderTopWidth={1}
          borderColor="$borderColor"
        >
          <PrimaryButton
            disabled={revoke.isPending}
            onPress={() => void revokeAll()}
            testID="approvals-revoke-all"
          >
            {fill(t("approvals.revokeAll"), { n: unlimited.length })}
          </PrimaryButton>
        </Stack>
      ) : null}
    </Page>
  );
}
