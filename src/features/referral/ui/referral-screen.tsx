import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { Share } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  PENDING_INVITE_TTL_MS,
  usePendingInviteStore,
} from "../../../core/deep-link/pending-invite-store";
import { useGateways } from "../../../core/gateways/gateway-context";
import { fill } from "../../../core/i18n/format";
import { useNow } from "../../../core/time/use-now";
import {
  AppIcon,
  Body,
  Card,
  Content,
  Heading,
  InlineText,
  Page,
  PageScroll,
  PageState,
  PrimaryButton,
  Row,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  Sheet,
  Stack,
  TextField,
  toast,
  useTheme,
  type SheetHandle,
} from "../../../design-system";
import type { RootStackParamList } from "../../../navigation/types";
import type { ReferralSource } from "../api/gateway";
import { formatInviteCode, referralErrorMessageKey } from "../model/referral";

/**
 * 邀请好友（设计 referral-graph-2026-09-15 §5.1）。
 *
 * 一期只有关系，**页面上不出现任何收益字样**。
 *
 * 两条不显然的规则：
 *  - 邀请人用**邀请码**表示，下级用别名。服务端不返回地址派生值，这里也没得显示。
 *  - 绑定永久不可解除，所以必须先弹确认层，不能点一下就绑（`PRODUCT_EXPERIENCE_STANDARD` §5）。
 */
export function ReferralScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Referral">) {
  const { t, config } = useFoundationRuntime();
  const theme = useTheme();
  const { referral } = useGateways();
  const queryClient = useQueryClient();
  const confirmSheet = useRef<SheetHandle>(null);
  const [draft, setDraft] = useState("");
  /** 用户在输入框里提交的码。深链带来的那个走 pendingInvite，两者互斥 */
  const [manualCode, setManualCode] = useState<string | null>(null);
  const pending = usePendingInviteStore((state) => state.pending);
  const forgetPending = usePendingInviteStore((state) => state.forget);

  // 租户没开启就不查：查了只会拿到 403，白白在界面上制造一个错误态。
  // hooks 不能条件调用，所以用 enabled 关掉而不是提前 return
  const enabled = config.referral.enabled;
  const overview = useQuery({
    queryKey: ["referral", "overview"],
    queryFn: () => referral.overview(),
    enabled,
  });
  const invitees = useQuery({
    queryKey: ["referral", "invitees"],
    queryFn: () => referral.invitees(),
    enabled,
  });

  const bind = useMutation({
    mutationFn: ({ code, source }: { code: string; source: ReferralSource }) =>
      referral.bind(code, source),
    onSuccess: () => {
      // 绑定成功就把暂存清掉，否则下次启动会再弹一次确认
      forgetPending();
      setDraft("");
      toast(t("referral.bound"), "success");
      void queryClient.invalidateQueries({ queryKey: ["referral"] });
    },
    onError: (error) => {
      // 失败也清暂存：不保留重试（设计 §5.3）。原因如实呈现，不吞。
      forgetPending();
      toast(t(referralErrorMessageKey(error)), "warning");
    },
  });

  // 深链暂存的有效期是 30 分钟：正常路径是"点了就登录"。过期的按设计就是失效，
  // 在渲染期派生出来即可，不用 effect 去算（effect 里 setState 会引发级联渲染）。
  // 取挂载时刻而不是 Date.now()：渲染期必须是纯的，而这个判断也不需要走秒
  const now = useNow();
  const pendingInvite =
    pending && now - pending.savedAt <= PENDING_INVITE_TTL_MS
      ? pending.code
      : null;
  // 深链带来的码只在"已加载、且还没有邀请人"时才进入确认；已绑定或过期都不弹
  const shouldConfirmPending = Boolean(
    pendingInvite && !manualCode && overview.data && !overview.data.inviter,
  );
  // 待确认的码：手输优先，其次是深链带来的。两者都要过确认层。
  // 没有待确认的码时确认层不渲染内容——它常驻挂载，否则"没弹出"也能被查到
  const confirmCode =
    manualCode ?? (shouldConfirmPending ? pendingInvite : null);
  const confirmSource: ReferralSource = manualCode ? "code" : "link";

  const askToBind = useCallback((code: string) => {
    setManualCode(code);
    confirmSheet.current?.present();
  }, []);

  // 深链带来的邀请码：先弹确认再绑，**不自动提交**。用户在深链里同意的是
  // "打开应用"，不是"永久挂在一个陌生人名下"。这里只做命令式呈现，不改状态。
  useEffect(() => {
    if (shouldConfirmPending) confirmSheet.current?.present();
  }, [shouldConfirmPending]);

  if (!enabled)
    return (
      <Page>
        <ScreenHeader title={t("referral.title")} onBack={navigation.goBack} />
        <PageState title={t("referral.disabled")} />
      </Page>
    );

  if (overview.isPending)
    return (
      <Page>
        <ScreenHeader title={t("referral.title")} onBack={navigation.goBack} />
        <PageState title={t("common.processing")} loading />
      </Page>
    );

  if (overview.isError || !overview.data)
    return (
      <Page>
        <ScreenHeader title={t("referral.title")} onBack={navigation.goBack} />
        <PageState
          title={t(referralErrorMessageKey(overview.error))}
          action={
            <SecondaryButton onPress={() => void overview.refetch()}>
              {t("action.retryNow")}
            </SecondaryButton>
          }
        />
      </Page>
    );

  const data = overview.data;
  const copy = async (value: string): Promise<void> => {
    await Clipboard.setStringAsync(value);
    toast(t("referral.copied"), "success");
  };

  return (
    <Page>
      <ScreenHeader title={t("referral.title")} onBack={navigation.goBack} />
      <PageScroll>
        <Content gap="$3">
          <Card gap="$3" alignItems="center" testID="referral-code-card">
            <SectionTitle>{t("referral.myCode")}</SectionTitle>
            <Heading
              fontSize={32}
              letterSpacing={2}
              testID="referral-code"
              accessibilityLabel={data.inviteCode}
            >
              {formatInviteCode(data.inviteCode)}
            </Heading>
            <QRCode
              value={data.inviteLink}
              size={160}
              backgroundColor={theme.surface.val}
              color={theme.text?.val ?? "#000000"}
            />
            <Body fontSize={13} color="$textMuted" textAlign="center">
              {t("referral.qrHint")}
            </Body>
            <Row gap="$2">
              <SecondaryButton
                flex={1}
                onPress={() => void copy(data.inviteCode)}
                testID="referral-copy-code"
              >
                {t("referral.copyCode")}
              </SecondaryButton>
              <SecondaryButton
                flex={1}
                onPress={() => void copy(data.inviteLink)}
                testID="referral-copy-link"
              >
                {t("referral.copyLink")}
              </SecondaryButton>
              <SecondaryButton
                flex={1}
                onPress={() => void Share.share({ message: data.inviteLink })}
                testID="referral-share"
              >
                {t("referral.share")}
              </SecondaryButton>
            </Row>
          </Card>

          <Card gap="$2" testID="referral-inviter-card">
            <SectionTitle>{t("referral.inviter")}</SectionTitle>
            {data.inviter ? (
              <Body testID="referral-inviter">
                {fill(t("referral.inviterBound"), {
                  code: formatInviteCode(data.inviter.inviteCode),
                  time: new Date(data.inviter.boundAt).toLocaleString(),
                })}
              </Body>
            ) : data.bindWindow.open ? (
              <Stack gap="$2">
                <Body fontSize={13} color="$textMuted">
                  {t("referral.bindHint")}
                </Body>
                <TextField
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={t("referral.bindPlaceholder")}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  testID="referral-code-input"
                  accessibilityLabel={t("referral.bindTitle")}
                />
                <InlineText fontSize={12} color="$textMuted">
                  {fill(t("referral.bindClosesAt"), {
                    time: new Date(data.bindWindow.closesAt).toLocaleString(),
                  })}
                </InlineText>
                <PrimaryButton
                  disabled={draft.trim() === "" || bind.isPending}
                  onPress={() => askToBind(draft)}
                  testID="referral-bind"
                >
                  {t("referral.bindAction")}
                </PrimaryButton>
              </Stack>
            ) : (
              <Body
                fontSize={13}
                color="$textMuted"
                testID="referral-window-closed"
              >
                {t("referral.windowClosed")}
              </Body>
            )}
          </Card>

          <Card gap="$2" testID="referral-invitees-card">
            <Row justifyContent="space-between" alignItems="center">
              <SectionTitle>{t("referral.invitees")}</SectionTitle>
              <InlineText fontSize={13} color="$textMuted">
                {fill(t("referral.inviteesCount"), { n: data.inviteeCount })}
              </InlineText>
            </Row>
            {invitees.data && invitees.data.items.length > 0 ? (
              <Stack gap="$2">
                {invitees.data.items.map((item) => (
                  <Row key={item.alias} justifyContent="space-between">
                    <InlineText>{item.alias}</InlineText>
                    <InlineText fontSize={13} color="$textMuted">
                      {fill(t("referral.inviteeJoined"), {
                        time: new Date(item.joinedAt).toLocaleDateString(),
                      })}
                    </InlineText>
                  </Row>
                ))}
                {invitees.data.hasMore ? (
                  <SecondaryButton
                    onPress={() => void invitees.refetch()}
                    testID="referral-load-more"
                  >
                    {t("referral.loadMore")}
                  </SecondaryButton>
                ) : null}
              </Stack>
            ) : (
              <Body
                fontSize={13}
                color="$textMuted"
                testID="referral-invitees-empty"
              >
                {t("referral.inviteesEmpty")}
              </Body>
            )}
          </Card>
        </Content>
      </PageScroll>

      {/* 绑定不可逆，必须显式确认。Toast 只用于低风险瞬时反馈，
          承担不了这种承诺（PRODUCT_EXPERIENCE_STANDARD §5） */}
      <Sheet
        ref={confirmSheet}
        title={t("referral.confirmTitle")}
        closeLabel={t("common.close")}
      >
        {confirmCode ? (
          <Content gap="$3">
            <Row gap="$2" alignItems="center">
              <AppIcon
                name="alert-circle-outline"
                size={20}
                colorToken="warning"
              />
              <Body flex={1} testID="referral-confirm-body">
                {fill(t("referral.confirmBody"), {
                  code: formatInviteCode(confirmCode ?? ""),
                })}
              </Body>
            </Row>
            <PrimaryButton
              disabled={bind.isPending}
              onPress={() => {
                if (confirmCode)
                  bind.mutate({ code: confirmCode, source: confirmSource });
                setManualCode(null);
                confirmSheet.current?.dismiss();
              }}
              testID="referral-confirm"
            >
              {t("referral.confirmAction")}
            </PrimaryButton>
            <SecondaryButton
              onPress={() => {
                // 拒绝也要把暂存清掉，否则下次进来又弹
                forgetPending();
                setManualCode(null);
                confirmSheet.current?.dismiss();
              }}
              testID="referral-confirm-cancel"
            >
              {t("common.cancel")}
            </SecondaryButton>
          </Content>
        ) : null}
      </Sheet>
    </Page>
  );
}
