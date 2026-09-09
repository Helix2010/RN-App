import { create } from "zustand";
import { emitUpdateTelemetry } from "./update-telemetry";

/** 当前可安装的全量版本（来自 bootstrap `update.full`） */
export type ApkReleaseTarget = {
  releaseId: string;
  url: string;
  /** 平台给的包大小；null 时无法核对完整性，只能信任系统安装器 */
  size: number | null;
};

export type ApkDownloadState =
  | { phase: "idle" }
  | {
      phase: "downloading";
      releaseId: string;
      written: number;
      total: number;
      bytesPerSecond: number;
    }
  | {
      phase: "paused";
      releaseId: string;
      written: number;
      total: number;
      reason: "network" | "stalled";
      /** 还会自动重试几次；0 = 等用户 */
      retriesLeft: number;
    }
  | {
      phase: "failed";
      releaseId: string;
      written: number;
      total: number;
      error: string;
    }
  | { phase: "ready"; releaseId: string; fileUri: string; size: number }
  | { phase: "installing"; releaseId: string; fileUri: string; size: number };

export type ApkDownloadTask = {
  /** 开始或从断点继续；成功时给出文件地址 */
  start(): Promise<{ uri: string } | undefined>;
  /** 中止本次传输，已写入的字节留在磁盘上 */
  pause(): Promise<unknown>;
};

/** 平台能力注入：生产用 expo-file-system / expo-intent-launcher / AppState，测试用假实现 */
export type ApkDownloadDeps = {
  /** 安装包目录（以 / 结尾） */
  directory: string;
  createDownload(input: {
    url: string;
    fileUri: string;
    /** 本地已有的字节数；有值就带 Range 续传并追加写 */
    resumeFrom: number | null;
    onProgress: (written: number, total: number) => void;
  }): ApkDownloadTask;
  fileInfo(uri: string): Promise<{ exists: boolean; size: number }>;
  deleteFile(uri: string): Promise<void>;
  ensureDirectory(directory: string): Promise<void>;
  listDirectory(directory: string): Promise<string[]>;
  openInstaller(fileUri: string): Promise<void>;
  isForeground(): boolean;
  onForeground(listener: () => void): () => void;
  now(): number;
  /** 多久没有进度回调算停滞（默认 20 秒） */
  stallMs?: number;
  /** 自动重试的退避间隔；用完进 failed（默认 1 / 3 / 8 秒） */
  retryDelaysMs?: number[];
};

type Store = { state: ApkDownloadState };
/** 下载状态的唯一来源：弹层、关于页、设置页都从这里读 */
export const useApkDownloadStore = create<Store>(() => ({
  state: { phase: "idle" },
}));

const DEFAULT_STALL_MS = 20_000;
const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

/** 文件名只用 releaseId 里的安全字符：服务端 id 是 `rel_` + 随机串，但客户端不把它当可信路径 */
export function apkFileName(releaseId: string): string {
  return `release-${releaseId.replace(/[^A-Za-z0-9_-]/g, "_")}.apk`;
}

/** 安装包只从 HTTPS 下载：bootstrap 本身走 HTTPS，但地址仍是服务端下发的字符串，这里再守一道 */
export function isAcceptableApkUrl(url: string): boolean {
  return /^https:\/\//i.test(url.trim());
}

/**
 * 安装包下载管理器（设计 apk-update-flow-2026-09-09 §4）：下载是页面之外的事——
 * 弹层关掉、切页、锁屏都不影响；断点续传靠磁盘上的部分文件（Android 的 resumeData 就是已写字节数）；
 * 停滞 / 断网自动暂停并按退避重试，回到前台立即续传；版本换了清掉旧文件。
 */
export class ApkDownloadManager {
  private target: ApkReleaseTarget | null = null;
  private task: ApkDownloadTask | null = null;
  private running: Promise<void> | null = null;
  private pausing = false;
  private attempts = 0;
  private restartedAfterMismatch = false;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastProgress: { at: number; written: number } | null = null;
  private unsubscribeForeground: (() => void) | null = null;

  constructor(
    private readonly deps: ApkDownloadDeps,
    private readonly setState: (state: ApkDownloadState) => void = (state) =>
      useApkDownloadStore.setState({ state }),
    private readonly getState: () => ApkDownloadState = () =>
      useApkDownloadStore.getState().state,
  ) {}

  get currentTarget(): ApkReleaseTarget | null {
    return this.target;
  }

  fileUriFor(releaseId: string): string {
    return `${this.deps.directory}${apkFileName(releaseId)}`;
  }

  /**
   * bootstrap 变化时调用。目标为空（没有可装的全量版本）→ 清空；换了版本 → 丢掉旧文件；
   * 同一版本 → 恢复：文件完整就是 ready，部分文件自动续传。
   */
  async configure(target: ApkReleaseTarget | null): Promise<void> {
    const previous = this.target;
    if (
      previous &&
      target &&
      previous.releaseId === target.releaseId &&
      previous.url === target.url
    )
      return;
    if (target && !isAcceptableApkUrl(target.url)) {
      console.warn("[updates] refusing non-https apk url");
      target = null;
    }
    this.target = target;
    try {
      if (!target) {
        await this.reset(true);
        return;
      }
      if (previous) await this.reset(false);
      this.unsubscribeForeground ??= this.deps.onForeground(() =>
        this.onForeground(),
      );
      await this.recover();
    } catch (error) {
      // 文件系统不可用之类的环境问题：不让它变成未处理的拒绝，状态回到 idle，用户点"立即更新"时再报错
      console.warn("[updates] apk download manager configure failed", error);
      this.setState({ phase: "idle" });
    }
  }

  /** 用户点"立即更新 / 继续下载 / 重试"：从磁盘上已有的字节接着下 */
  start(): void {
    const state = this.getState();
    if (state.phase === "downloading") return;
    if (state.phase === "ready" || state.phase === "installing") {
      void this.install();
      return;
    }
    this.clearRetryTimer();
    this.attempts = 0;
    this.launch();
  }

  /** 拉起系统安装器；用户取消后仍是 ready / installing，可再点 */
  async install(): Promise<void> {
    const state = this.getState();
    if (state.phase !== "ready" && state.phase !== "installing") return;
    this.setState({ ...state, phase: "installing" });
    try {
      await this.deps.openInstaller(state.fileUri);
    } catch (error) {
      this.setState({ ...state, phase: "ready" });
      throw error;
    }
  }

  dispose(): void {
    this.clearStallTimer();
    this.clearRetryTimer();
    this.unsubscribeForeground?.();
    this.unsubscribeForeground = null;
  }

  private async reset(clearAll: boolean): Promise<void> {
    this.clearStallTimer();
    this.clearRetryTimer();
    this.attempts = 0;
    this.restartedAfterMismatch = false;
    if (this.task) {
      this.pausing = true;
      await this.task.pause().catch(() => undefined);
      await this.running?.catch(() => undefined);
    }
    this.setState({ phase: "idle" });
    if (clearAll) await this.cleanDirectory(null);
  }

  private async cleanDirectory(keep: string | null): Promise<void> {
    await this.deps.ensureDirectory(this.deps.directory);
    const files = await this.deps.listDirectory(this.deps.directory);
    await Promise.all(
      files
        .filter((uri) => uri !== keep)
        .map((uri) => this.deps.deleteFile(uri).catch(() => undefined)),
    );
  }

  private async recover(): Promise<void> {
    const target = this.target;
    if (!target) return;
    const fileUri = this.fileUriFor(target.releaseId);
    await this.cleanDirectory(fileUri);
    const info = await this.deps.fileInfo(fileUri);
    if (!info.exists || info.size <= 0) {
      this.setState({ phase: "idle" });
      return;
    }
    if (target.size !== null && info.size === target.size) {
      this.setState({
        phase: "ready",
        releaseId: target.releaseId,
        fileUri,
        size: info.size,
      });
      return;
    }
    if (target.size !== null && info.size > target.size) {
      await this.deps.deleteFile(fileUri);
      this.setState({ phase: "idle" });
      return;
    }
    // 上次没下完（用户主动开始过）：冷启动自动续传，不用再点一次
    this.launch();
  }

  private launch(): void {
    if (this.running) return;
    this.running = this.run().finally(() => {
      this.running = null;
    });
  }

  private async run(): Promise<void> {
    const target = this.target;
    if (!target) return;
    const fileUri = this.fileUriFor(target.releaseId);
    let written = 0;
    // 上一次 reset / stall 留下的"正在中止"标记不能带进新一次传输
    this.pausing = false;
    try {
      await this.deps.ensureDirectory(this.deps.directory);
      const info = await this.deps.fileInfo(fileUri);
      let resumeFrom = info.exists && info.size > 0 ? info.size : null;
      if (resumeFrom !== null && target.size !== null) {
        if (resumeFrom === target.size) {
          this.setState({
            phase: "ready",
            releaseId: target.releaseId,
            fileUri,
            size: resumeFrom,
          });
          return;
        }
        if (resumeFrom > target.size) {
          await this.deps.deleteFile(fileUri);
          resumeFrom = null;
        }
      }
      written = resumeFrom ?? 0;
      this.lastProgress = { at: this.deps.now(), written };
      this.setState({
        phase: "downloading",
        releaseId: target.releaseId,
        written,
        total: target.size ?? 0,
        bytesPerSecond: 0,
      });
      emitUpdateTelemetry({
        stage: "downloading",
        updateId: target.releaseId,
        channel: "apk",
      });
      const task = this.deps.createDownload({
        url: target.url,
        fileUri,
        resumeFrom,
        onProgress: (nextWritten, total) => {
          written = nextWritten;
          this.onProgress(target, nextWritten, total);
        },
      });
      this.task = task;
      this.pausing = false;
      this.armStallTimer();
      let result: { uri: string } | undefined;
      try {
        result = await task.start();
      } finally {
        this.clearStallTimer();
        this.task = null;
      }
      if (this.pausing) return;
      if (!result?.uri) throw new Error("download produced no file");
      const done = await this.deps.fileInfo(result.uri);
      if (!done.exists) throw new Error("downloaded file is missing");
      if (target.size !== null && done.size !== target.size) {
        // 服务端没按 Range 回 206（续传追加成了整包），或传输被截断：丢掉重来一次
        await this.deps.deleteFile(result.uri);
        if (!this.restartedAfterMismatch) {
          this.restartedAfterMismatch = true;
          this.running = null;
          this.launch();
          return;
        }
        throw new Error("downloaded size does not match the release");
      }
      this.restartedAfterMismatch = false;
      this.attempts = 0;
      this.setState({
        phase: "ready",
        releaseId: target.releaseId,
        fileUri: result.uri,
        size: done.size,
      });
      emitUpdateTelemetry({
        stage: "ready",
        updateId: target.releaseId,
        channel: "apk",
      });
    } catch (error) {
      if (this.pausing) return;
      this.handleFailure(target, written, error);
    }
  }

  private onProgress(target: ApkReleaseTarget, written: number, total: number) {
    const now = this.deps.now();
    const previous = this.lastProgress;
    const elapsed = previous ? now - previous.at : 0;
    const bytesPerSecond =
      previous && elapsed > 0
        ? Math.max(0, ((written - previous.written) * 1000) / elapsed)
        : 0;
    this.lastProgress = { at: now, written };
    this.setState({
      phase: "downloading",
      releaseId: target.releaseId,
      written,
      total: total > 0 ? total : (target.size ?? 0),
      bytesPerSecond,
    });
    this.armStallTimer();
  }

  private armStallTimer(): void {
    this.clearStallTimer();
    this.stallTimer = setTimeout(
      () => void this.stall(),
      this.deps.stallMs ?? DEFAULT_STALL_MS,
    );
  }

  private clearStallTimer(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** 一段时间没有进度：中止本次传输，保留文件，按退避自动续传 */
  private async stall(): Promise<void> {
    const task = this.task;
    const target = this.target;
    if (!task || !target) return;
    this.pausing = true;
    await task.pause().catch(() => undefined);
    await this.running?.catch(() => undefined);
    this.pausing = false;
    this.schedulePause(target, this.lastProgress?.written ?? 0, "stalled");
  }

  private handleFailure(
    target: ApkReleaseTarget,
    written: number,
    error: unknown,
  ): void {
    const delays = this.deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    if (this.attempts >= delays.length) {
      const message = error instanceof Error ? error.message : String(error);
      this.setState({
        phase: "failed",
        releaseId: target.releaseId,
        written,
        total: target.size ?? 0,
        error: message,
      });
      emitUpdateTelemetry({
        stage: "error",
        updateId: target.releaseId,
        channel: "apk",
        error,
      });
      return;
    }
    this.schedulePause(target, written, "network");
  }

  private schedulePause(
    target: ApkReleaseTarget,
    written: number,
    reason: "network" | "stalled",
  ): void {
    const delays = this.deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    const delay = delays[this.attempts];
    this.attempts += 1;
    this.setState({
      phase: "paused",
      releaseId: target.releaseId,
      written,
      total: target.size ?? 0,
      reason,
      retriesLeft: Math.max(0, delays.length - this.attempts + 1),
    });
    if (delay === undefined) {
      // 退避用完：停在 paused 等用户或回前台
      this.setState({
        phase: "failed",
        releaseId: target.releaseId,
        written,
        total: target.size ?? 0,
        error: reason,
      });
      return;
    }
    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      // 后台时不重试，回到前台再续（进程可能被系统限流）
      if (!this.deps.isForeground()) return;
      this.launch();
    }, delay);
  }

  private onForeground(): void {
    const state = this.getState();
    if (state.phase !== "paused" && state.phase !== "failed") return;
    if (
      state.phase === "failed" &&
      state.error !== "stalled" &&
      state.error !== "network"
    )
      return;
    this.clearRetryTimer();
    this.attempts = 0;
    this.launch();
  }
}
