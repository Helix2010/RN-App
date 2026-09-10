import { create } from "zustand";
import { emitUpdateTelemetry } from "./update-telemetry";

/** 当前可安装的全量版本（来自 bootstrap `update.full`） */
export type ApkReleaseTarget = {
  releaseId: string;
  url: string;
  /** 平台给的包大小；用于续传与第一道完整性判断 */
  size: number | null;
  /** bootstrap `update.full.sha256`（hex）：安装前文件摘要必须与之一致；缺失即不可直装（安全评审 N2） */
  sha256: string | null;
  /** 下载地址必须与租户 API 同源（N2）：bootstrap 本身走 HTTPS，但地址仍是服务端下发的字符串 */
  allowedOrigin: string;
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
      /** 快速退避还剩几次；0 = 已转为慢速轮询（前台每 slowRetryMs 试一次），用户也可随时点"继续" */
      retriesLeft: number;
    }
  | {
      /** 只有非网络原因才是终态：文件校验不过、磁盘写不进等；网络问题永远停在 paused 自动重试 */
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
  /** 文件的 SHA-256（hex）；分块读取，不把整包读进内存 */
  hashFile(uri: string): Promise<string>;
  isForeground(): boolean;
  onForeground(listener: () => void): () => void;
  now(): number;
  /** 多久没有进度回调算停滞（默认 20 秒） */
  stallMs?: number;
  /** 快速自动重试的退避间隔（默认 1 / 3 / 8 秒） */
  retryDelaysMs?: number[];
  /** 快速退避用完后，前台每隔多久再试一次（默认 30 秒）；后台不试，回前台立刻试 */
  slowRetryMs?: number;
};

type Store = { state: ApkDownloadState };
/** 下载状态的唯一来源：弹层、关于页、设置页都从这里读 */
export const useApkDownloadStore = create<Store>(() => ({
  state: { phase: "idle" },
}));

const DEFAULT_STALL_MS = 20_000;
const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000, 8_000];
const DEFAULT_SLOW_RETRY_MS = 30_000;

/** 管理器自己判定的、重试也没用的错误：与网络异常区分开，后者永远自动续传 */
export class ApkIntegrityError extends Error {
  readonly kind = "integrity";
}

/** 文件名只用 releaseId 里的安全字符：服务端 id 是 `rel_` + 随机串，但客户端不把它当可信路径 */
export function apkFileName(releaseId: string): string {
  return `release-${releaseId.replace(/[^A-Za-z0-9_-]/g, "_")}.apk`;
}

/** 安装包只从 HTTPS、且与租户 API 同源的地址下载（安全评审 N2） */
export function isAcceptableApkUrl(
  url: string,
  allowedOrigin: string,
): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" && parsed.origin === allowedOrigin;
  } catch {
    // 解析不了的字符串不是可接受的下载地址
    return false;
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** 文件摘要必须等于 bootstrap 给的 sha256；大小写无关，其余任何差异都是不符 */
export function digestMatches(expected: string, actual: string): boolean {
  return expected.trim().toLowerCase() === actual.trim().toLowerCase();
}

/** 通过安全前提检查的目标：sha256 一定存在，后续摘要比对不再需要判空 */
type VerifiedApkTarget = ApkReleaseTarget & { sha256: string };

/** 目标不满足安全前提的原因；null = 可以下载 */
export function apkTargetRefusal(target: ApkReleaseTarget): string | null {
  if (!isAcceptableApkUrl(target.url, target.allowedOrigin))
    return "apk url is not https or not the tenant api origin";
  if (target.sha256 === null || !SHA256_HEX.test(target.sha256.trim()))
    return "release has no sha256 to verify the download against";
  return null;
}

/**
 * 安装包下载管理器（设计 apk-update-flow-2026-09-09 §4）：下载是页面之外的事——
 * 弹层关掉、切页、锁屏都不影响；断点续传靠磁盘上的部分文件（Android 的 resumeData 就是已写字节数）；
 * 停滞 / 断网自动暂停并按退避重试，回到前台立即续传；版本换了清掉旧文件。
 */
export class ApkDownloadManager {
  private target: VerifiedApkTarget | null = null;
  /** 上一次被拒目标的指纹：bootstrap 每次重取都会再 configure 一次，同一目标只告警、上报一次 */
  private lastRefusalKey: string | null = null;
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
      previous.url === target.url &&
      previous.sha256 === target.sha256
    )
      return;
    const refusal = target ? apkTargetRefusal(target) : null;
    this.target =
      target && !refusal && target.sha256 !== null
        ? { ...target, sha256: target.sha256 }
        : null;
    try {
      if (!target) {
        this.lastRefusalKey = null;
        await this.reset(true);
        return;
      }
      if (refusal) {
        // 服务端下发的目标不满足安全前提：不下载，也不装作没有更新——失败态让用户与运营都看得见
        const refusalKey = [
          target.releaseId,
          target.url,
          String(target.sha256),
          refusal,
        ].join("|");
        if (this.lastRefusalKey !== refusalKey) {
          this.lastRefusalKey = refusalKey;
          console.warn(`[updates] refusing apk target: ${refusal}`);
          emitUpdateTelemetry({
            stage: "error",
            updateId: target.releaseId,
            channel: "apk",
            error: refusal,
          });
        }
        await this.reset(true);
        this.setState({
          phase: "failed",
          releaseId: target.releaseId,
          written: 0,
          total: target.size ?? 0,
          error: refusal,
        });
        return;
      }
      this.lastRefusalKey = null;
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
    // 用户主动重试：校验不过后再给一次"删掉重下"的机会
    this.restartedAfterMismatch = false;
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
      // 冷启动恢复的完整文件同样要过摘要：上次没校验完就被杀进程、或磁盘上的文件已不是当初下的
      if (await this.digestOk(target, fileUri)) {
        this.setState({
          phase: "ready",
          releaseId: target.releaseId,
          fileUri,
          size: info.size,
        });
      } else {
        // 与下载完成后的处理一致：删除、失败态、上报；用户点"重试"会重新下载
        await this.deps.deleteFile(fileUri);
        this.setState({
          phase: "failed",
          releaseId: target.releaseId,
          written: 0,
          total: target.size,
          error: "downloaded file hash does not match the release",
        });
        emitUpdateTelemetry({
          stage: "error",
          updateId: target.releaseId,
          channel: "apk",
          error: "cold-start digest mismatch",
        });
      }
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
    const running: Promise<void> = this.run().finally(() => {
      // 校验不符后 run() 内部会重启一次：旧的 finally 不能把新一轮的引用清掉
      if (this.running === running) this.running = null;
    });
    this.running = running;
  }

  /** 摘要必须与 bootstrap 一致；读文件失败也算完整性问题（重试无济于事） */
  private async digestOk(
    target: VerifiedApkTarget,
    fileUri: string,
  ): Promise<boolean> {
    let actual: string;
    try {
      actual = await this.deps.hashFile(fileUri);
    } catch (error) {
      throw new ApkIntegrityError(
        `could not hash the downloaded file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return digestMatches(target.sha256, actual);
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
          if (await this.digestOk(target, fileUri)) {
            this.setState({
              phase: "ready",
              releaseId: target.releaseId,
              fileUri,
              size: resumeFrom,
            });
            return;
          }
          await this.deps.deleteFile(fileUri);
          resumeFrom = null;
        } else if (resumeFrom > target.size) {
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
      if (!result?.uri)
        throw new ApkIntegrityError("download produced no file");
      const done = await this.deps.fileInfo(result.uri);
      if (!done.exists)
        throw new ApkIntegrityError("downloaded file is missing");
      if (target.size !== null && done.size !== target.size) {
        // 服务端没按 Range 回 206（续传追加成了整包），或传输被截断：丢掉重来一次
        await this.deps.deleteFile(result.uri);
        if (!this.restartedAfterMismatch) {
          this.restartedAfterMismatch = true;
          this.running = null;
          this.launch();
          return;
        }
        throw new ApkIntegrityError(
          "downloaded size does not match the release",
        );
      }
      if (!(await this.digestOk(target, result.uri))) {
        // 大小对但摘要不对：传输损坏或文件被换。给一次重下机会，再不对就是终态，不交给安装器
        await this.deps.deleteFile(result.uri);
        if (!this.restartedAfterMismatch) {
          this.restartedAfterMismatch = true;
          this.running = null;
          this.launch();
          return;
        }
        throw new ApkIntegrityError(
          "downloaded file hash does not match the release",
        );
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

  /**
   * 传输报错：网络类问题不设终点——快速退避几次后转慢速轮询，回前台立刻再试，
   * 用户随时可点"继续"；只有校验不过这类重试也无济于事的错误才进 failed。
   */
  private handleFailure(
    target: ApkReleaseTarget,
    written: number,
    error: unknown,
  ): void {
    if (error instanceof ApkIntegrityError) {
      this.clearRetryTimer();
      this.setState({
        phase: "failed",
        releaseId: target.releaseId,
        written,
        total: target.size ?? 0,
        error: error.message,
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
    const fast = delays[this.attempts];
    if (fast !== undefined) this.attempts += 1;
    const retriesLeft = Math.max(0, delays.length - this.attempts);
    this.setState({
      phase: "paused",
      releaseId: target.releaseId,
      written,
      total: target.size ?? 0,
      reason,
      retriesLeft,
    });
    if (fast === undefined && this.attempts === delays.length) {
      // 快速退避刚用完：记一次遥测，之后的慢速轮询不再刷
      this.attempts += 1;
      emitUpdateTelemetry({
        stage: "error",
        updateId: target.releaseId,
        channel: "apk",
        error: reason,
      });
    }
    const delay = fast ?? this.deps.slowRetryMs ?? DEFAULT_SLOW_RETRY_MS;
    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      // 后台时不重试，回到前台再续（进程可能被系统限流）
      if (!this.deps.isForeground()) return;
      this.launch();
    }, delay);
  }

  /** 回前台：暂停中的传输立刻续，退避从头算（failed 是校验类终态，等用户点"重试"） */
  private onForeground(): void {
    if (this.getState().phase !== "paused") return;
    this.clearRetryTimer();
    this.attempts = 0;
    this.launch();
  }
}
