import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { redactSecrets } from "../core/security/secret-scan";
import { systemLocale } from "../core/config/system-locale";
import {
  recordCrash,
  setFatalErrorPresenter,
} from "../core/diagnostics/crash-capture";
import {
  completeManualCrashReport,
  crashFingerprint,
} from "../core/diagnostics/crash-reporter";
import {
  CRASH_TAIL_ENTRIES,
  crashErrorName,
  topFrameName,
} from "../core/diagnostics/crash-snapshot";
import { tailLogs } from "../core/diagnostics/log-buffer";
import {
  prepareReport,
  submitReport,
} from "../core/diagnostics/report-service";

/**
 * 根级错误边界。渲染期异常和发布构建里的致命全局异常到这里都变成一个能操作的界面，
 * 而不是白屏：
 * - 重试（渲染崩溃）：重新挂载整棵树（导航状态一起重置，等价于"回到首页"）；
 * - 重启应用（致命全局异常）：模块级状态可能已经坏了，重挂载不够，重新加载 JS；
 * - 上报问题：发一份崩溃报告，原地显示参考号（设计 diagnostic-report-2026-09-14 §7.4）。
 *   以前是"复制诊断信息"，让用户自己把一大段文本发给客服；现在念一个参考号就够了。
 *
 * 崩溃本身在 componentDidCatch 里已经记进日志并留了快照；用户不点上报，下次启动也会
 * 按自动上报的闸门处理。点了并且成功，快照随之删除，不会再自动发一遍。
 *
 * 这里刻意不用设计系统与运行时上下文——它们都可能就是崩溃的原因——只用 RN 原生
 * 组件和一份内置的中英文案。
 */

type State = {
  error: Error | null;
  diagnosticId: string;
  info: string;
  /** render = 渲染崩溃（可重试）；global = 致命全局异常（只能重启） */
  source: "render" | "global";
};

const COPY = {
  zh: {
    title: "应用遇到了问题",
    body: "这一页没能正常显示。你可以重试；如果反复出现，请上报给我们。",
    globalBody: "应用运行出错了。请重启应用；如果反复出现，请上报给我们。",
    retry: "重试",
    restart: "重启应用",
    report: "上报问题",
    sending: "正在上报…",
    reference: "参考号",
    referenceHint: "把参考号告诉客服即可",
    failed: "上报没成功，请稍后重试",
  },
  en: {
    title: "Something went wrong",
    body: "This screen could not be shown. You can retry; if it keeps happening, report it to us.",
    globalBody:
      "The app ran into an error. Restart it; if it keeps happening, report it to us.",
    retry: "Retry",
    restart: "Restart app",
    report: "Report problem",
    sending: "Sending…",
    reference: "Reference",
    referenceHint: "Give this reference to support",
    failed: "Could not send the report. Try again later",
  },
};

function newDiagnosticId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type ReportState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; reference: string }
  | { kind: "failed" };

type BoundaryState = State & { report: ReportState; generation: number };

export class RootErrorBoundary extends Component<
  { children: ReactNode },
  BoundaryState
> {
  override state: BoundaryState = {
    error: null,
    diagnosticId: "",
    info: "",
    source: "render",
    report: { kind: "idle" },
    generation: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, diagnosticId: newDiagnosticId(), source: "render" };
  }

  override componentDidMount(): void {
    setFatalErrorPresenter(this.presentFatal);
  }

  override componentWillUnmount(): void {
    setFatalErrorPresenter(null);
  }

  /** 致命全局异常：已经由全局处理器记过日志和快照，这里只负责显示 */
  private presentFatal = (thrown: unknown): void => {
    const error =
      thrown instanceof Error ? thrown : new Error("Non-error thrown");
    this.setState({
      error,
      diagnosticId: newDiagnosticId(),
      info: "",
      source: "global",
      report: { kind: "idle" },
    });
  };

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info: info.componentStack ?? "" });
    recordCrash("render", error, {
      componentStack: info.componentStack ?? undefined,
    });
    // 异常的 message 可能带着助记词（导入失败、解密失败都会把输入拼进去）。
    // 这里不能直接把 error 交给 console.error——它会打印完整对象（安全评审 §12.2）
    console.error(
      `[root-error-boundary] ${this.state.diagnosticId || "pending"}`,
      redactSecrets(`${error.name}: ${error.message}`),
      redactSecrets(info.componentStack ?? ""),
    );
  }

  private retry = (): void => {
    // 换 key 重新挂载整棵树：导航状态一起重置，等价于回到首页
    this.setState((state) => ({
      error: null,
      diagnosticId: "",
      info: "",
      source: "render",
      report: { kind: "idle" },
      generation: state.generation + 1,
    }));
  };

  /** 重新加载 JS；加载不了（开发构建、未启用 expo-updates）就退回重新挂载 */
  private restart = (): void => {
    Updates.reloadAsync().catch(() => this.retry());
  };

  /**
   * 这里不能用设计系统和运行时上下文，所以直接调 report-service。日志取当前缓冲的尾巴，
   * 版本取此刻在跑的——崩溃就发生在此刻，不存在"重启后换了一版"的问题。
   */
  private report = async (): Promise<void> => {
    const { error, info } = this.state;
    this.setState({ report: { kind: "sending" } });
    try {
      const errorName = crashErrorName(error);
      const fingerprint = await crashFingerprint(
        errorName,
        topFrameName(error?.stack ?? info),
      );
      const prepared = prepareReport({
        kind: "crash",
        locale: systemLocale(),
        crash: { fingerprint, errorName },
        entries: tailLogs(CRASH_TAIL_ENTRIES),
      });
      const outcome = await submitReport(prepared);
      await completeManualCrashReport(prepared, outcome);
      this.setState({
        report:
          outcome.status === "submitted"
            ? { kind: "done", reference: outcome.reference }
            : { kind: "failed" },
      });
    } catch {
      // 崩溃界面自己不能再崩
      this.setState({ report: { kind: "failed" } });
    }
  };

  override render(): ReactNode {
    const { error, generation, report, source } = this.state;
    if (!error)
      return (
        <View key={generation} style={styles.fill}>
          {this.props.children}
        </View>
      );
    const copy = systemLocale() === "en-US" ? COPY.en : COPY.zh;
    return (
      <View style={styles.screen} testID="root-error-boundary">
        {/* 崩溃页固定浅底：状态栏图标跟着用深色，不跟系统深色模式变白 */}
        <StatusBar style="dark" />
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>
          {source === "global" ? copy.globalBody : copy.body}
        </Text>
        <Text style={styles.mono} numberOfLines={3}>
          {error.name}: {error.message}
        </Text>
        {source === "global" ? (
          <Pressable
            style={styles.primary}
            onPress={this.restart}
            accessibilityRole="button"
            testID="root-error-restart"
          >
            <Text style={styles.primaryText}>{copy.restart}</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.primary}
            onPress={this.retry}
            accessibilityRole="button"
            testID="root-error-retry"
          >
            <Text style={styles.primaryText}>{copy.retry}</Text>
          </Pressable>
        )}
        {report.kind === "done" ? (
          <View style={styles.referenceBox} testID="root-error-reported">
            <Text style={styles.body}>{copy.reference}</Text>
            <Text
              style={styles.reference}
              selectable
              testID="root-error-reference"
            >
              {report.reference}
            </Text>
            <Text style={styles.body}>{copy.referenceHint}</Text>
          </View>
        ) : (
          <Pressable
            style={styles.secondary}
            onPress={() => void this.report()}
            disabled={report.kind === "sending"}
            accessibilityRole="button"
            accessibilityState={{ busy: report.kind === "sending" }}
            testID="root-error-report"
          >
            <Text style={styles.secondaryText}>
              {report.kind === "sending" ? copy.sending : copy.report}
            </Text>
          </Pressable>
        )}
        {report.kind === "failed" ? (
          <Text style={styles.body} testID="root-error-report-failed">
            {copy.failed}
          </Text>
        ) : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    gap: 12,
    backgroundColor: "#F7F9FC",
  },
  title: { fontSize: 20, fontWeight: "800", color: "#0B1220" },
  body: { fontSize: 14, color: "#3C4656", lineHeight: 20 },
  mono: {
    fontSize: 12,
    color: "#707A8A",
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  primary: {
    marginTop: 8,
    backgroundColor: "#0B1220",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  secondary: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#D5DBE3",
  },
  secondaryText: { color: "#0B1220", fontWeight: "600", fontSize: 15 },
  referenceBox: { alignItems: "center", gap: 4, paddingVertical: 8 },
  reference: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 4,
    color: "#0B1220",
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
});
