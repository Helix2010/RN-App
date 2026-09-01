import { useEffect, useState } from "react";
import { fill } from "../../core/i18n/format";
import { Linking, Modal } from "react-native";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  downloadAndInstallApk,
  type ApkDownloadProgress,
} from "../../core/updates/apk-update-service";
import {
  shouldPromptUpdate,
  useUpdatePromptStore,
} from "../../core/updates/update-prompt-store";
import {
  AppIcon,
  Body,
  Card,
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

/**
 * S-07 更新弹窗。软更新：冷启动弹一次，同版本 24h 内不重复，可"稍后再说"。
 * 强制更新：无"稍后再说"，遮罩与系统返回都不关闭，副标题说明此版本已停服。
 * Android 直装包走应用内下载（按钮变进度条 → 安装），其余走系统打开更新地址。
 */
export function UpdateModal() {
  const {
    config,
    t,
    manualUpdatePromptVersion,
    dismissUpdatePrompt,
    checkForUpdates,
  } = useFoundationRuntime();
  const lastPromptedVersion = useUpdatePromptStore(
    (state) => state.lastPromptedVersion,
  );
  const lastPromptedAt = useUpdatePromptStore((state) => state.lastPromptedAt);
  const markPrompted = useUpdatePromptStore((state) => state.markPrompted);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState<ApkDownloadProgress | null>(null);
  const [installing, setInstalling] = useState(false);
  // "打开商店 / 仅刷新更新信息"两个分支之前没有进行中态，能反复点出多个并发请求
  const [busy, setBusy] = useState(false);

  const update = config.update;
  const forced = update.decision === "required";
  const canDirectInstall =
    config.app.platform === "android" &&
    config.app.distribution === "direct" &&
    config.features.directUpdateEnabled &&
    Boolean(update.full.actionUrl);
  // 只在挂载时判定一次：随后写入节流记录会让 shouldPromptUpdate 变 false，
  // 若每次渲染都算，弹窗会在记录写入的瞬间把自己关掉。
  const [eligible] = useState(() =>
    shouldPromptUpdate({
      decision: update.decision,
      latestVersion: update.latestVersion,
      lastPromptedVersion,
      lastPromptedAt,
      nowMs: Date.now(),
    }),
  );
  const manualPrompt =
    manualUpdatePromptVersion === update.latestVersion &&
    update.decision !== "none";
  const visible =
    forced ||
    (dismissedVersion !== update.latestVersion &&
      Boolean(update.full.actionUrl) &&
      (eligible || manualPrompt));

  // 记录本次提醒，供 24h 节流；强制更新不写（每次都要弹）
  useEffect(() => {
    if (visible && !forced) markPrompted(update.latestVersion);
  }, [forced, markPrompted, update.latestVersion, visible]);

  if (!visible) return null;

  const downloading = progress !== null;
  const percent = progress ? Math.round(progress.percentage) : 0;

  const onUpdate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await runUpdate();
    } finally {
      setBusy(false);
    }
  };

  const runUpdate = async () => {
    if (!update.full.actionUrl) {
      await checkForUpdates();
      return;
    }
    if (!canDirectInstall) {
      await Linking.openURL(update.full.actionUrl);
      toast(t("update.openedStore"), "info");
      return;
    }
    setProgress({ written: 0, total: update.full.size ?? 0, percentage: 0 });
    try {
      await downloadAndInstallApk(config, setProgress);
      setInstalling(true);
      toast(t("update.apkInstallerOpened"), "success");
    } catch {
      setProgress(null);
      toast(t("update.downloadFailed"), "error");
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      // 强制更新：系统返回键不关闭
      onRequestClose={() => {
        if (!forced) {
          setDismissedVersion(update.latestVersion);
          dismissUpdatePrompt();
        }
      }}
      testID="update-modal"
    >
      <Stack
        flex={1}
        justifyContent="flex-end"
        padding="$4"
        backgroundColor="$backdrop"
        // 强制更新：点遮罩不关闭
        onPress={
          forced
            ? undefined
            : () => {
                setDismissedVersion(update.latestVersion);
                dismissUpdatePrompt();
              }
        }
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
          {downloading && !installing ? (
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
              <Body fontSize={12} textAlign="center">
                {fill(t("update.downloading"), { percent })}
              </Body>
            </Stack>
          ) : (
            <PrimaryButton
              onPress={() => void onUpdate()}
              disabled={busy}
              testID="update-modal-now"
            >
              {installing
                ? t("update.install")
                : update.full.actionUrl
                  ? t("update.now")
                  : t("action.retry")}
            </PrimaryButton>
          )}
          {forced ? null : (
            <SecondaryButton
              onPress={() => {
                setDismissedVersion(update.latestVersion);
                dismissUpdatePrompt();
              }}
              testID="update-modal-later"
            >
              {t("update.later")}
            </SecondaryButton>
          )}
        </Card>
      </Stack>
    </Modal>
  );
}
