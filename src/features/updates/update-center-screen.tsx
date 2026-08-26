import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  applyDownloadedOta,
  checkAndDownloadOta,
  openFullUpdate,
  type OtaCheckResult,
} from "../../core/updates/update-service";
import {
  Badge,
  Body,
  Card,
  Content,
  Heading,
  InlineText,
  Label,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  SecondaryButton,
  SectionTitle,
  Stack,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "UpdateCenter"> & {
  locked?: boolean;
};

export function UpdateCenterScreen({ navigation, locked = false }: Props) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const [ota, setOta] = useState<OtaCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [fullMessage, setFullMessage] = useState<string | null>(null);

  const checkOta = async (): Promise<void> => {
    setBusy(true);
    setOta(await checkAndDownloadOta(config));
    setBusy(false);
  };

  const openFull = async (): Promise<void> => {
    setBusy(true);
    const opened = await openFullUpdate(config);
    setFullMessage(
      opened
        ? "已打开当前分发渠道的升级入口"
        : "服务端尚未为当前分发渠道配置可安装地址",
    );
    setBusy(false);
  };

  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 20}>
          {!locked ? (
            <SecondaryButton
              alignSelf="flex-start"
              onPress={() => navigation.goBack()}
            >
              返回
            </SecondaryButton>
          ) : null}
          <Stack gap="$2" paddingVertical="$3">
            <Label>RELEASE CONTROL</Label>
            <Heading>{t("home.update")}</Heading>
            <Body>{t(`update.${config.update.decision}`)}</Body>
          </Stack>

          <Card>
            <Row justifyContent="space-between" alignItems="center">
              <SectionTitle>版本策略</SectionTitle>
              <Badge>
                <InlineText
                  color={
                    config.update.decision === "required"
                      ? "$danger"
                      : "$primary"
                  }
                >
                  {config.update.decision.toUpperCase()}
                </InlineText>
              </Badge>
            </Row>
            <Body>
              当前版本：{config.app.version} ({config.app.buildNumber})
            </Body>
            <Body>最低支持：{config.update.minSupportedVersion}</Body>
            <Body>最新版本：{config.update.latestVersion}</Body>
            <Body>分发通道：{config.update.full.channel}</Body>
          </Card>

          <Card>
            <Label>OTA / {config.update.ota.channel}</Label>
            <SectionTitle>JS 与资源热更新</SectionTitle>
            <Body>runtime · {config.update.ota.runtimeVersion}</Body>
            {ota ? (
              <Body color={ota.status === "error" ? "$danger" : "$textMuted"}>
                {ota.message}
              </Body>
            ) : null}
            <PrimaryButton disabled={busy} onPress={() => void checkOta()}>
              {busy ? "检查中…" : t("action.checkUpdate")}
            </PrimaryButton>
            {ota?.status === "ready" ? (
              <SecondaryButton onPress={() => void applyDownloadedOta()}>
                重启并应用 OTA
              </SecondaryButton>
            ) : null}
          </Card>

          <Card>
            <Label>{config.update.full.channel.toUpperCase()}</Label>
            <SectionTitle>全量更新</SectionTitle>
            <Body>
              Store 打开应用市场；Android direct 打开签名 APK；iOS MDM
              打开受控企业入口。
            </Body>
            {config.update.releaseNotes.map((note) => (
              <Body key={note}>• {note}</Body>
            ))}
            {fullMessage ? <Body color="$warning">{fullMessage}</Body> : null}
            <PrimaryButton disabled={busy} onPress={() => void openFull()}>
              {t("action.install")}
            </PrimaryButton>
          </Card>

          <Card>
            <Label>DIAGNOSTICS</Label>
            <Body>request · {config.support.diagnosticId}</Body>
            <Body>
              release · {config.update.full.releaseId ?? "not configured"}
            </Body>
            <Body>runtime · {config.app.runtimeVersion}</Body>
          </Card>
        </Content>
      </PageScroll>
    </Page>
  );
}
