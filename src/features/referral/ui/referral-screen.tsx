import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { Share } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  isPendingInviteFresh,
  usePendingInviteStore,
} from "../../../core/deep-link/pending-invite-store";
import { logEvent } from "../../../core/diagnostics/log-buffer";
import { useGateways } from "../../../core/gateways/gateway-context";
import { AppError } from "../../../core/network/app-error";
import { fill, formatTimeUntil } from "../../../core/i18n/format";
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
import { useSession } from "../../session/hooks/use-session";
import { requestAuth } from "../../session/model/auth-sheet-store";
import type { ReferralSource } from "../api/gateway";
import { useReferralOverview } from "../hooks/use-referral";
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
  /** 服务端在本次会话里回过 REFERRAL_DISABLED：租户刚把邀请关了，bootstrap 还没刷新 */
  const [disabledByServer, setDisabledByServer] = useState(false);
  const pending = usePendingInviteStore((state) => state.pending);
  const forgetPending = usePendingInviteStore((state) => state.forget);

  // 租户没开启就不查：查了只会拿到 403，白白在界面上制造一个错误态。
  // hooks 不能条件调用，所以用 enabled 关掉而不是提前 return
  const enabled = config.referral.enabled;
  // 走 useReferralOverview 而不是自己再开一个 useQuery：个人中心用的就是它，
  // 两边 queryKey 不同会变成两份缓存、两次请求，还可能显示不一致的已邀请人数
  // （AGENTS.md「架构边界」：禁止为同一状态建立多个事实源）
  const session = useSession();
  const address = session.data?.address;
  const overview = useReferralOverview(address);
  // 下级列表是键集分页：必须把上一页的 nextCursor 传下去。
  // 用 useQuery + refetch 会一直重拉第一页，网关的 cursor 参数永远用不上。
  const invitees = useInfiniteQuery({
    queryKey: ["referral", "invitees"],
    queryFn: ({ pageParam }) => referral.invitees(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
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
      setManualCode(null);
      // 租户在这期间把邀请关了：设计 §5.1 要求如实呈现"该功能已关闭"，
      // 不是一个一闪而过的 toast。整页切成关闭态，和进页面时的表现一致
      if (error instanceof AppError && error.code === "REFERRAL_DISABLED") {
        setDisabledByServer(true);
        return;
      }
      toast(t(referralErrorMessageKey(error)), "warning");
      // 失败原因可能正是"你在别的设备上已经绑过了"，那时服务端的状态比本地新。
      // 不刷新的话页面会继续显示输入框，和真实状态对不上（设计 §5.3 最后一行）。
      void queryClient.invalidateQueries({ queryKey: ["referral"] });
    },
  });

  // 深链暂存的有效期是 30 分钟：正常路径是"点了就登录"。过期的按设计就是失效，
  // 在渲染期派生出来即可，不用 effect 去算（effect 里 setState 会引发级联渲染）。
  // 取挂载时刻而不是 Date.now()：渲染期必须是纯的。**提交那一刻会再判一次**，
  // 因为页面可能已经挂了很久（见确认按钮）
  const now = useNow();
  const pendingInvite = isPendingInviteFresh(pending, now)
    ? (pending?.code ?? null)
    : null;
  // 深链带来的码只在"已加载、且还没有邀请人"时才进入确认；已绑定或过期都不弹。
  // bind.isPending 也要排除：用户手输的码提交之后、mutation 还没落地的那几帧里，
  // 如果这里翻成 true，用户刚确认完一次不可解除的绑定就会被要求确认另一个码
  const shouldConfirmPending = Boolean(
    pendingInvite &&
    !manualCode &&
    !bind.isPending &&
    overview.data &&
    !overview.data.inviter,
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

  /**
   * 关掉确认层就等于拒绝：暂存与手输的码都清掉。
   *
   * 必须挂在 Sheet 的 onDismiss 上，不能只写在"取消"按钮里——×、下滑、点遮罩
   * 都直接调组件内部的 dismiss，绕开页面里的任何清理。设计 §5.3 的暂存边界表
   * 要求"拒绝一律清除暂存"，而对用户来说点 × 就是拒绝。
   *
   * 确认路径也会走到这里（提交后主动 dismiss），清掉同样是对的：
   * 码已经进了 mutation 的参数，而 onSuccess / onError 本来也要清暂存。
   */
  const dismissConfirm = useCallback(() => {
    forgetPending();
    setManualCode(null);
  }, [forgetPending]);

  /** 暂存的消费记一条本地事件，与监听器里的写入配对（设计 §5.3）。不记邀请码本身。 */
  const logPendingConsumed = useCallback(
    (outcome: "submitted" | "expired") => {
      if (!pending) return;
      logEvent("info", "nav", "pending invite consumed", {
        outcome,
        ageMs: Date.now() - pending.savedAt,
      });
    },
    [pending],
  );

  // 深链带来的邀请码：先弹确认再绑，**不自动提交**。用户在深链里同意的是
  // "打开应用"，不是"永久挂在一个陌生人名下"。这里只做命令式呈现，不改状态。
  useEffect(() => {
    if (shouldConfirmPending) confirmSheet.current?.present();
  }, [shouldConfirmPending]);

  // 游客态：首页的邀请快捷格不看登录状态，点进来可能没有会话。概览是会话级的，
  // 没有地址就不该查——拉起登录并退回上一页，照个人中心的既有做法
  useEffect(() => {
    if (!session.isLoading && !address) {
      requestAuth();
      if (navigation.canGoBack()) navigation.goBack();
    }
  }, [address, navigation, session.isLoading]);

  if (!enabled || disabledByServer)
    return (
      <Page>
        <ScreenHeader title={t("referral.title")} onBack={navigation.goBack} />
        <PageState title={t("referral.disabled")} />
      </Page>
    );

  if (!address) return <Page />;

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
  const inviteeRows = (invitees.data?.pages ?? []).flatMap(
    (page) => page.items,
  );
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
                  {/* 设计 §5.1 要的是**剩余时间**，不是一个绝对时间戳：
                      "还有多久"才是用户要做的决定，"9 月 22 日 08:00"要自己算。
                      绝对时间留在括号里给需要精确的人。
                      useNow() 不 ticking 正是给这类天/小时粒度文案用的 */}
                  {fill(t("referral.bindClosesAt"), {
                    remaining:
                      formatTimeUntil(
                        data.bindWindow.closesAt,
                        now,
                        config.localization.selectedLocale,
                      ) || t("referral.windowClosingSoon"),
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
            {invitees.isError ? (
              // 查询失败是错误状态，不是"还没有人"。同一张卡里 inviteeCount 来自
              // overview，把失败画成空态会出现"已邀请 3 人"和"还没有人加入"并排
              // （AGENTS.md「正式场景开发原则」）
              <Stack gap="$2">
                <Body
                  fontSize={13}
                  color="$textMuted"
                  testID="referral-invitees-error"
                >
                  {t(referralErrorMessageKey(invitees.error))}
                </Body>
                <SecondaryButton
                  onPress={() => void invitees.refetch()}
                  testID="referral-invitees-retry"
                >
                  {t("action.retryNow")}
                </SecondaryButton>
              </Stack>
            ) : inviteeRows.length > 0 ? (
              <Stack gap="$2">
                {inviteeRows.map((item) => (
                  <Row key={item.alias} justifyContent="space-between">
                    <InlineText>{item.alias}</InlineText>
                    <InlineText fontSize={13} color="$textMuted">
                      {fill(t("referral.inviteeJoined"), {
                        time: new Date(item.joinedAt).toLocaleDateString(),
                      })}
                    </InlineText>
                  </Row>
                ))}
                {invitees.hasNextPage ? (
                  <SecondaryButton
                    disabled={invitees.isFetchingNextPage}
                    onPress={() => void invitees.fetchNextPage()}
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
        onDismiss={dismissConfirm}
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
                  code: formatInviteCode(confirmCode),
                })}
              </Body>
            </Row>
            <PrimaryButton
              disabled={bind.isPending}
              onPress={() => {
                // 深链带来的码在提交这一刻重新判一次新鲜度：渲染期用的是挂载
                // 时刻，而这个页面可能已经在后台挂了几小时（设计 §5.3 的 30 分钟
                // 是安全闸，不能只在渲染期成立）
                if (
                  confirmSource === "link" &&
                  !isPendingInviteFresh(pending, Date.now())
                ) {
                  logPendingConsumed("expired");
                  toast(t("referral.error.expired"), "warning");
                  // 过期就是失效：立刻清掉，不等 onDismiss。
                  // 留着的话下次进页面又会弹一次同一个过期码
                  dismissConfirm();
                  confirmSheet.current?.dismiss();
                  return;
                }
                if (confirmSource === "link") logPendingConsumed("submitted");
                bind.mutate({ code: confirmCode, source: confirmSource });
                // 这里**不清 manualCode**：清了会让 shouldConfirmPending 在
                // mutation 落地前翻成 true，把深链那个码又弹一次。
                // 清理统一交给 onDismiss
                confirmSheet.current?.dismiss();
              }}
              testID="referral-confirm"
            >
              {t("referral.confirmAction")}
            </PrimaryButton>
            <SecondaryButton
              onPress={() => {
                // 显式清理再关：不只依赖 onDismiss。清理是幂等的，
                // 两条路径都跑一遍无害，而"取消"这条不该依赖组件回调的时序
                dismissConfirm();
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
