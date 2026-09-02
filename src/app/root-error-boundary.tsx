import * as Clipboard from "expo-clipboard";
import { getLocales } from "expo-localization";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { appRuntime } from "../core/network/api-client";

/**
 * 根级错误边界。任何渲染期异常到这里都变成一个能操作的界面，而不是白屏：
 * - 重试：重新挂载整棵树（导航状态一起重置，等价于"回到首页"）；
 * - 复制诊断信息：诊断 ID、版本、构建号、渠道、错误名与消息、组件栈。
 *
 * 这里刻意不用设计系统与运行时上下文——它们都可能就是崩溃的原因——只用 RN 原生
 * 组件和一份内置的中英文案。
 */

type State = { error: Error | null; diagnosticId: string; info: string };

const COPY = {
  zh: {
    title: "应用遇到了问题",
    body: "这一页没能正常显示。你可以重试；如果反复出现，请把诊断信息发给我们。",
    retry: "重试",
    copy: "复制诊断信息",
    copied: "已复制",
    id: "诊断 ID",
  },
  en: {
    title: "Something went wrong",
    body: "This screen could not be shown. You can retry; if it keeps happening, send us the diagnostics.",
    retry: "Retry",
    copy: "Copy diagnostics",
    copied: "Copied",
    id: "Diagnostic ID",
  },
};

function newDiagnosticId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type BoundaryState = State & { copied: boolean; generation: number };

export class RootErrorBoundary extends Component<
  { children: ReactNode },
  BoundaryState
> {
  override state: BoundaryState = {
    error: null,
    diagnosticId: "",
    info: "",
    copied: false,
    generation: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, diagnosticId: newDiagnosticId() };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info: info.componentStack ?? "" });
    console.error(
      `[root-error-boundary] ${this.state.diagnosticId || "pending"}`,
      error,
      info.componentStack,
    );
  }

  private diagnostics(): string {
    const { error, diagnosticId, info } = this.state;
    return [
      `diagnosticId: ${diagnosticId}`,
      `time: ${new Date().toISOString()}`,
      `app: ${appRuntime.version} (${appRuntime.buildNumber}) ${appRuntime.platform} ${appRuntime.distributionChannel}`,
      `runtimeVersion: ${appRuntime.runtimeVersion}`,
      `error: ${error?.name ?? "Error"}: ${error?.message ?? ""}`,
      `componentStack: ${info.trim()}`,
    ].join("\n");
  }

  private retry = (): void => {
    // 换 key 重新挂载整棵树：导航状态一起重置，等价于回到首页
    this.setState((state) => ({
      error: null,
      diagnosticId: "",
      info: "",
      copied: false,
      generation: state.generation + 1,
    }));
  };

  private copy = async (): Promise<void> => {
    await Clipboard.setStringAsync(this.diagnostics());
    this.setState({ copied: true });
  };

  override render(): ReactNode {
    const { error, generation, copied, diagnosticId } = this.state;
    if (!error)
      return (
        <View key={generation} style={styles.fill}>
          {this.props.children}
        </View>
      );
    const copy = getLocales()[0]?.languageCode === "en" ? COPY.en : COPY.zh;
    return (
      <View style={styles.screen} testID="root-error-boundary">
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>
        <Text style={styles.mono} testID="root-error-diagnostic-id">
          {copy.id}: {diagnosticId}
        </Text>
        <Text style={styles.mono} numberOfLines={3}>
          {error.name}: {error.message}
        </Text>
        <Pressable
          style={styles.primary}
          onPress={this.retry}
          accessibilityRole="button"
          testID="root-error-retry"
        >
          <Text style={styles.primaryText}>{copy.retry}</Text>
        </Pressable>
        <Pressable
          style={styles.secondary}
          onPress={() => void this.copy()}
          accessibilityRole="button"
          testID="root-error-copy"
        >
          <Text style={styles.secondaryText}>
            {copied ? copy.copied : copy.copy}
          </Text>
        </Pressable>
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
});
