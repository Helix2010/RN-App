import { useState } from "react";
import { Linking } from "react-native";
import { useFoundationRuntime } from "../../app/runtime-context";
import { fill, formatCompactNumber } from "../../core/i18n/format";
import { getApkDownloadManager } from "../../core/updates/apk-download";
import {
  useApkDownloadStore,
  type ApkDownloadState,
} from "../../core/updates/apk-download-manager";
import {
  AppIcon,
  Body,
  Card,
  FullScreenOverlay,
  InlineText,
  Label,
  PrimaryButton,
  Row,
  SecondaryButton,
  SectionTitle,
  Stack,
  toast,
} from "../../design-system";

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function percentOf(state: ApkDownloadState): number {
  if (
    state.phase !== "downloading" &&
    state.phase !== "paused" &&
    state.phase !== "failed"
  )
    return 0;
  return state.total > 0
    ? Math.min(100, Math.round((state.written / state.total) * 100))
    : 0;
}

/**
 * S-07 升级弹层（设计 apk-update-flow-2026-09-09 §3.1）。
 * 何时弹：有新版本时每个进程冷启动一次；手动检查 / 下载就绪时再弹；前台切回不弹；"稍后"只对本次进程有效。
 * 强制更新：无"稍后"，遮罩与系统返回都不关闭。
 * 下载由 `ApkDownloadManager` 负责，这里只是它的视图：关掉弹层下载继续，主按钮随下载状态变。
 */
export function UpdateModal() {
  const {
    config,
    t,
    manualUpdatePrompt,
    dismissUpdatePrompt,
    checkForUpdates,
  } = useFoundationRuntime();
  const download = useApkDownloadStore((state) => state.state);
  const update = config.update;
  const forced = update.decision === "required";
  const hasUpdate =
    update.decision !== "none" && Boolean(update.full.actionUrl);
  const canDirectInstall =
    config.app.platform === "android" &&
    config.app.distribution === "direct" &&
    config.features.directUpdateEnabled &&
    Boolean(update.full.actionUrl) &&
    Boolean(update.full.releaseId);
  const [open, setOpen] = useState(false);
  // 三种"这次要弹"的来源，各记一次，避免同一来源反复打开被用户关掉的弹层
  const [coldStartHandled, setColdStartHandled] = useState(false);
  const [handledManualAt, setHandledManualAt] = useState<number | null>(null);
  const [readyPromptedFor, setReadyPromptedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 冷启动弹一次：只看进程内首次渲染时的版本。会话中途（前台刷新）冒出来的推荐更新不自动弹，
  // 关于 / 设置页有红点与入口；强制更新不受此限（visible 里单独判）
  if (!coldStartHandled) {
    setColdStartHandled(true);
    if (hasUpdate) setOpen(true);
  }
  // 手动检查：每次都是新的请求，哪怕上次已经关掉
  if (
    hasUpdate &&
    manualUpdatePrompt &&
    manualUpdatePrompt.requestedAt !== handledManualAt
  ) {
    setHandledManualAt(manualUpdatePrompt.requestedAt);
    setOpen(true);
  }
  // 下载完成：用户主动开始的事，完成时把"安装"送到眼前（后台完成的话回前台就看到）
  if (
    hasUpdate &&
    download.phase === "ready" &&
    readyPromptedFor !== download.releaseId
  ) {
    setReadyPromptedFor(download.releaseId);
    setOpen(true);
  }

  const visible = hasUpdate && (forced || open);
  if (!visible) return null;

  const close = () => {
    setOpen(false);
    dismissUpdatePrompt();
  };
  const sameRelease =
    download.phase !== "idle" && download.releaseId === update.full.releaseId;
  const phase = sameRelease ? download.phase : "idle";
  const percent = sameRelease ? percentOf(download) : 0;

  const onPrimary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!update.full.actionUrl) {
        await checkForUpdates();
        return;
      }
      if (!canDirectInstall) {
        await Linking.openURL(update.full.actionUrl);
        toast(t("update.openedStore"), "info");
        return;
      }
      const manager = getApkDownloadManager();
      if (phase === "ready" || phase === "installing") {
        try {
          await manager.install();
          toast(t("update.apkInstallerOpened"), "success");
        } catch {
          toast(t("update.downloadFailed"), "error");
        }
        return;
      }
      manager.start();
    } finally {
      setBusy(false);
    }
  };

  const primaryLabel = !update.full.actionUrl
    ? t("action.retry")
    : phase === "ready" || phase === "installing"
      ? t("update.install")
      : phase === "paused"
        ? t("update.resume")
        : phase === "failed"
          ? t("update.retryDownload")
          : t("update.now");
  const statusLine =
    phase === "paused" && sameRelease && download.phase === "paused"
      ? download.retriesLeft > 0 && download.reason === "network"
        ? t("update.pausedRetrying")
        : t(
            download.reason === "stalled"
              ? "update.pausedStalled"
              : "update.pausedNetwork",
          )
      : phase === "failed"
        ? t("update.downloadFailed")
        : phase === "ready"
          ? t("update.readyToInstall")
          : phase === "installing"
            ? t("update.installerOpened")
            : null;

  return (
    // 走应用级覆盖层而不是原生 Modal：下载失败等 toast 要能盖在弹窗上面
    <FullScreenOverlay
      visible
      // 强制更新：系统返回键不关闭
      onRequestClose={forced ? undefined : close}
      testID="update-modal"
    >
      <Stack
        flex={1}
        justifyContent="flex-end"
        padding="$4"
        backgroundColor="$backdrop"
        // 强制更新：点遮罩不关闭
        onPress={forced ? undefined : close}
        accessibilityRole={forced ? undefined : "button"}
        accessibilityLabel={forced ? undefined : t("common.close")}
      >
        <Card
          padding="$5"
          gap="$3"
          onPress={() => undefined}
          testID="update-modal-card"
        >
          <Row alignItems="center" gap="$2">
            <AppIcon
              name="cellphone-arrow-down"
              size={20}
              colorToken="primary"
            />
            <Label color="$primary">{t(`update.${update.decision}`)}</Label>
          </Row>
          <SectionTitle fontSize={20}>
            {fill(t("update.modalTitle"), { version: update.latestVersion })}
          </SectionTitle>
          <Body fontSize={12}>
            {fill(t("update.modalMeta"), {
              size: formatSize(update.full.size),
              current: config.app.version,
            })}
          </Body>
          {forced ? (
            <Body color="$warning">{t("update.forceSubtitle")}</Body>
          ) : null}
          {forced && !update.full.actionUrl ? (
            <Stack gap="$2">
              <Body color="$danger">{t("update.fullUnavailable")}</Body>
              {/* 强制更新却没有安装包 = 配置错误把全体用户锁在这一页。
                  给一个逃生口，让用户至少能看到服务状态 / 联系方式 */}
              <Body
                color="$primary"
                onPress={() =>
                  void Linking.openURL(config.support.statusPageUrl)
                }
                accessibilityRole="link"
                testID="update-modal-status-page"
              >
                {t("update.statusPage")}
              </Body>
            </Stack>
          ) : null}
          <Stack gap="$1.5">
            {update.releaseNotes.slice(0, 3).map((note) => (
              <Row key={note} gap="$2" alignItems="flex-start">
                <InlineText color="$primary">•</InlineText>
                <Body flex={1}>{note}</Body>
              </Row>
            ))}
          </Stack>
          {phase === "downloading" &&
          sameRelease &&
          download.phase === "downloading" ? (
            <Stack gap="$1.5" testID="update-modal-progress">
              <Stack
                height={10}
                borderRadius={5}
                backgroundColor="$surfaceVariant"
                overflow="hidden"
              >
                <Stack
                  height={10}
                  width={`${percent}%`}
                  backgroundColor="$primary"
                />
              </Stack>
              <Row justifyContent="space-between">
                <Body fontSize={12}>
                  {fill(t("update.downloading"), { percent })}
                </Body>
                {download.bytesPerSecond > 0 ? (
                  <Body fontSize={12}>
                    {fill(t("update.speed"), {
                      speed: `${formatCompactNumber(download.bytesPerSecond / 1024 / 1024, config.localization.selectedLocale)} MB`,
                    })}
                  </Body>
                ) : null}
              </Row>
              <Body fontSize={11} color="$textMuted">
                {t("update.backgroundHint")}
              </Body>
            </Stack>
          ) : (
            <Stack gap="$1.5">
              {phase === "paused" || phase === "failed" ? (
                <Stack
                  height={6}
                  borderRadius={3}
                  backgroundColor="$surfaceVariant"
                  overflow="hidden"
                >
                  <Stack
                    height={6}
                    width={`${percent}%`}
                    backgroundColor="$primary"
                  />
                </Stack>
              ) : null}
              {statusLine ? (
                <Body
                  fontSize={12}
                  color={phase === "failed" ? "$danger" : "$textMuted"}
                  testID="update-modal-status"
                >
                  {statusLine}
                </Body>
              ) : null}
              <PrimaryButton
                onPress={() => void onPrimary()}
                disabled={busy}
                testID="update-modal-now"
              >
                {primaryLabel}
              </PrimaryButton>
            </Stack>
          )}
          {forced ? null : (
            <SecondaryButton onPress={close} testID="update-modal-later">
              {t("update.later")}
            </SecondaryButton>
          )}
        </Card>
      </Stack>
    </FullScreenOverlay>
  );
}
