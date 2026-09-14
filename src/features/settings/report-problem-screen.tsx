import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import { resumeAutoReports } from "../../core/diagnostics/crash-gates";
import {
  completeManualCrashReport,
  preparePendingCrashReport,
} from "../../core/diagnostics/crash-reporter";
import type { LogEntry } from "../../core/diagnostics/log-buffer";
import {
  prepareReport,
  submitReport,
  type PreparedReport,
  type ReportFailure,
} from "../../core/diagnostics/report-service";
import { fill } from "../../core/i18n/format";
import {
  ActionButton,
  Body,
  Card,
  Content,
  DetailRow,
  Page,
  PageScroll,
  PageState,
  PrimaryButton,
  ScreenHeader,
  SectionTitle,
  Stack,
  TextField,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";

/**
 * 上报问题（设计 diagnostic-report-2026-09-14 §7.2）。
 *
 * 进页面时就把要发的内容定下来（`prepareReport`），原样摊给用户看；确认后发送的是
 * 同一个对象。这是知情同意：用户看到的就是我们收到的，一个字节不多。
 */

type Phase =
  | { kind: "compose" }
  | { kind: "sending" }
  | { kind: "done"; reference: string; logStored: boolean }
  | { kind: "failed"; reason: ReportFailure };

const MONOSPACE = Platform.select({ ios: "Menlo", default: "monospace" });

function entryLine(entry: LogEntry): string {
  const time = new Date(entry.at).toISOString().slice(11, 23);
  const fields = Object.entries(entry.fields ?? {})
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return `${time} ${entry.level.toUpperCase()} ${entry.tag} ${entry.message}${fields ? ` ${fields}` : ""}`;
}

export function ReportProblemScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, "ReportProblem">) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  // 设置页「上次异常退出」进来的：报告内容来自崩溃快照（崩溃时的版本与日志尾巴）
  const fromCrash = route?.params?.source === "crash";
  const [prepared, setPrepared] = useState<PreparedReport | "loading" | "gone">(
    () => (fromCrash ? "loading" : prepareReport({ kind: "user", locale })),
  );
  useEffect(() => {
    if (!fromCrash) return;
    let active = true;
    void preparePendingCrashReport(locale).then((pending) => {
      if (active) setPrepared(pending ? pending.prepared : "gone");
    });
    return () => {
      active = false;
    };
  }, [fromCrash, locale]);
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });

  if (prepared === "loading" || prepared === "gone")
    return (
      <Page>
        <Content paddingTop={insets.top + 8} paddingBottom={0}>
          <ScreenHeader
            title={t("diagnostics.crashReportTitle")}
            onBack={() => navigation.goBack()}
            backLabel={t("action.back")}
          />
        </Content>
        <Stack flex={1} testID={`report-problem-crash-${prepared}`}>
          <PageState
            title={
              prepared === "gone"
                ? t("diagnostics.crashGone")
                : t("common.processing")
            }
            loading={prepared === "loading"}
          />
        </Stack>
      </Page>
    );

  const send = async (): Promise<void> => {
    setPhase({ kind: "sending" });
    const outcome = await submitReport(prepared, note);
    if (outcome.status === "submitted") {
      // 手动上报成功就是"用户操作过一次"：解除崩溃循环熔断；崩溃来源的还要删快照、记指纹
      await completeManualCrashReport(prepared, outcome);
      await resumeAutoReports();
    }
    setPhase(
      outcome.status === "submitted"
        ? {
            kind: "done",
            reference: outcome.reference,
            logStored: outcome.logStored,
          }
        : { kind: "failed", reason: outcome.reason },
    );
  };

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={
            fromCrash
              ? t("diagnostics.crashReportTitle")
              : t("diagnostics.report")
          }
          onBack={() => navigation.goBack()}
          backLabel={t("action.back")}
        />
      </Content>
      <PageScroll>
        {phase.kind === "done" ? (
          <Content
            paddingTop="$6"
            gap="$3"
            alignItems="center"
            testID="report-problem-done"
          >
            <SectionTitle fontSize={20}>
              {t("diagnostics.submitted")}
            </SectionTitle>
            <Body>{t("diagnostics.reference")}</Body>
            <SectionTitle
              fontSize={32}
              letterSpacing={4}
              style={{ fontFamily: MONOSPACE }}
              selectable
              testID="report-problem-reference"
            >
              {phase.reference}
            </SectionTitle>
            <Body textAlign="center">{t("diagnostics.referenceHint")}</Body>
            {phase.logStored ? null : (
              <Body
                textAlign="center"
                color="$warning"
                fontSize={13}
                testID="report-problem-log-missing"
              >
                {t("diagnostics.logUploadFailed")}
              </Body>
            )}
            <PrimaryButton
              alignSelf="stretch"
              marginTop="$4"
              onPress={() => navigation.goBack()}
              testID="report-problem-close"
            >
              {t("diagnostics.done")}
            </PrimaryButton>
          </Content>
        ) : (
          <Content paddingTop="$2" gap="$4" paddingBottom={40}>
            <Body fontSize={13}>{t("diagnostics.hint")}</Body>
            <Stack gap="$2">
              <SectionTitle fontSize={14}>
                {t("diagnostics.noteLabel")}
              </SectionTitle>
              <TextField
                value={note}
                onChangeText={setNote}
                placeholder={t("diagnostics.notePlaceholder")}
                accessibilityLabel={t("diagnostics.noteLabel")}
                maxLength={200}
                multiline
                editable={phase.kind !== "sending"}
                testID="report-problem-note"
              />
            </Stack>
            <Stack gap="$2">
              <SectionTitle fontSize={14}>
                {t("diagnostics.preview")}
              </SectionTitle>
              <Card padding="$3" gap="$1" testID="report-problem-preview">
                <DetailRow
                  label={t("update.currentVersion")}
                  value={fill(t("update.versionValue"), {
                    version: prepared.app.version,
                    build: prepared.app.buildNumber,
                  })}
                />
                <DetailRow
                  label={t("update.runtime")}
                  value={prepared.app.runtimeVersion}
                />
                <DetailRow
                  label={t("update.otaChannel")}
                  value={prepared.app.otaChannel}
                />
                <DetailRow
                  label={t("update.channel")}
                  value={prepared.app.distributionChannel}
                />
                <DetailRow
                  label={t("update.otaTitle")}
                  value={
                    prepared.app.runningUpdateId ?? prepared.app.launchSource
                  }
                />
                <DetailRow
                  label={t("update.platform")}
                  value={`${prepared.app.deviceClass} ${prepared.app.osVersion}`}
                />
                {prepared.context.screen ? (
                  <DetailRow
                    label={t("diagnostics.previewScreen")}
                    value={prepared.context.screen}
                  />
                ) : null}
                {prepared.context.lastRequestId ? (
                  <DetailRow
                    label={t("update.requestId")}
                    value={prepared.context.lastRequestId}
                  />
                ) : null}
                <Body fontSize={12} marginTop="$2">
                  {prepared.entries.length > 0
                    ? fill(t("diagnostics.previewEntries"), {
                        count: prepared.entries.length,
                      })
                    : t("diagnostics.previewNoEntries")}
                </Body>
                {prepared.entries.length > 0 ? (
                  <Body
                    fontSize={11}
                    lineHeight={16}
                    style={{ fontFamily: MONOSPACE }}
                    selectable
                    testID="report-problem-entries"
                  >
                    {prepared.entries.map(entryLine).join("\n")}
                  </Body>
                ) : null}
              </Card>
            </Stack>
            {phase.kind === "failed" ? (
              <Body color="$danger" fontSize={13} testID="report-problem-error">
                {t(`diagnostics.failed.${phase.reason}`)}
              </Body>
            ) : null}
            <ActionButton
              onPress={() => void send()}
              loading={phase.kind === "sending"}
              loadingLabel={t("common.processing")}
              width="100%"
              alignSelf="stretch"
              testID="report-problem-submit"
            >
              {t("diagnostics.submit")}
            </ActionButton>
          </Content>
        )}
      </PageScroll>
    </Page>
  );
}
