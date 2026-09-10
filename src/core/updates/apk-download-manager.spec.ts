import { setUpdateTelemetrySink } from "./update-telemetry";
import {
  ApkDownloadManager,
  apkFileName,
  apkTargetRefusal,
  digestMatches,
  isAcceptableApkUrl,
  type ApkDownloadDeps,
  type ApkDownloadState,
  type ApkDownloadTask,
} from "./apk-download-manager";

const managers: ApkDownloadManager[] = [];
/** bootstrap 下发的摘要；假文件系统默认让每个文件都算出这个值 */
const GOOD_SHA256 = "a".repeat(64);
const ORIGIN = "https://api.test";

/** 假文件系统 + 可控的下载任务：测试自己决定每次 start() 是完成、报错还是挂着 */
function makeDeps(size = 1_000) {
  const files = new Map<string, number>();
  const directory = "file:///cache/apk-updates/";
  let foreground = true;
  const foregroundListeners = new Set<() => void>();
  type FakeTask = {
    resumeFrom: number | null;
    progress: (written: number, total: number) => void;
    resolve: (uri?: string) => void;
    reject: (error: Error) => void;
    paused: boolean;
  };
  const tasks: FakeTask[] = [];
  const installs: string[] = [];
  const digests = new Map<string, string>();
  let now = 1_000_000;
  const states: ApkDownloadState[] = [];
  const deps: ApkDownloadDeps = {
    directory,
    createDownload: ({ fileUri, resumeFrom, onProgress }): ApkDownloadTask => {
      const entry: FakeTask = {
        resumeFrom,
        progress: onProgress,
        resolve: () => undefined,
        reject: () => undefined,
        paused: false,
      };
      const done = new Promise<{ uri: string } | undefined>(
        (resolve, reject) => {
          entry.resolve = (uri?: string) =>
            resolve(uri === undefined ? undefined : { uri });
          entry.reject = reject;
        },
      );
      tasks.push(entry);
      return {
        start: () => done,
        pause: async () => {
          entry.paused = true;
          entry.reject(new Error("cancelled"));
        },
      };
    },
    fileInfo: async (uri) =>
      files.has(uri)
        ? { exists: true, size: files.get(uri) ?? 0 }
        : { exists: false, size: 0 },
    deleteFile: async (uri) => {
      files.delete(uri);
    },
    ensureDirectory: async () => undefined,
    listDirectory: async () => [...files.keys()],
    openInstaller: async (uri) => {
      installs.push(uri);
    },
    hashFile: async (uri) => {
      const digest = digests.get(uri);
      return digest === undefined ? GOOD_SHA256 : digest;
    },
    isForeground: () => foreground,
    onForeground: (listener) => {
      foregroundListeners.add(listener);
      return () => foregroundListeners.delete(listener);
    },
    now: () => now,
    stallMs: 100,
    retryDelaysMs: [10, 20, 30],
    slowRetryMs: 40,
  };
  let state: ApkDownloadState = { phase: "idle" };
  const manager = new ApkDownloadManager(
    deps,
    (next) => {
      state = next;
      states.push(next);
    },
    () => state,
  );
  managers.push(manager);
  const target = {
    releaseId: "rel_1",
    url: `${ORIGIN}/v1/public/releases/rel_1/download`,
    size,
    sha256: GOOD_SHA256,
    allowedOrigin: ORIGIN,
  };
  const fileUri = `${directory}release-rel_1.apk`;
  return {
    manager,
    target,
    fileUri,
    files,
    tasks,
    installs,
    digests,
    states,
    state: () => state,
    tick: (ms: number) => {
      now += ms;
    },
    setForeground: (value: boolean) => {
      foreground = value;
      if (value) for (const listener of foregroundListeners) listener();
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ApkDownloadManager", () => {
  beforeEach(() => jest.useRealTimers());
  // 慢速轮询是无限的：每个用例结束都把定时器拆掉，否则 jest 退不出
  afterEach(() => {
    for (const manager of managers.splice(0)) manager.dispose();
  });

  it("downloads from scratch, reports progress and speed, verifies size and becomes ready", async () => {
    const h = makeDeps(1_000);
    await h.manager.configure(h.target);
    expect(h.state().phase).toBe("idle");
    h.manager.start();
    await flush();
    expect(h.state().phase).toBe("downloading");
    expect(h.tasks[0]?.resumeFrom).toBeNull();
    h.tick(1_000);
    h.tasks[0]!.progress(500, 1_000);
    expect(h.state()).toMatchObject({
      phase: "downloading",
      written: 500,
      bytesPerSecond: 500,
    });
    h.files.set(h.fileUri, 1_000);
    h.tasks[0]!.resolve(h.fileUri);
    await flush();
    expect(h.state()).toMatchObject({
      phase: "ready",
      fileUri: h.fileUri,
      size: 1_000,
    });
    await h.manager.install();
    expect(h.installs).toEqual([h.fileUri]);
    expect(h.state().phase).toBe("installing");
  });

  it("resumes from the bytes already on disk after a network error: fast backoff, then slow polling, never a dead end", async () => {
    const h = makeDeps(1_000);
    await h.manager.configure(h.target);
    h.manager.start();
    await flush();
    h.tasks[0]!.progress(300, 1_000);
    h.files.set(h.fileUri, 300);
    h.tasks[0]!.reject(new Error("socket closed"));
    await flush();
    expect(h.state()).toMatchObject({
      phase: "paused",
      reason: "network",
      written: 300,
      retriesLeft: 2,
    });
    // 第一次自动重试从 300 字节续
    await new Promise((resolve) => setTimeout(resolve, 15));
    await flush();
    expect(h.tasks).toHaveLength(2);
    expect(h.tasks[1]?.resumeFrom).toBe(300);
    h.tasks[1]!.reject(new Error("socket closed"));
    await new Promise((resolve) => setTimeout(resolve, 25));
    await flush();
    h.tasks[2]!.reject(new Error("socket closed"));
    await flush();
    expect(h.state()).toMatchObject({ phase: "paused", retriesLeft: 0 });
    await new Promise((resolve) => setTimeout(resolve, 35));
    await flush();
    h.tasks[3]!.reject(new Error("socket closed"));
    await flush();
    // 快速退避用完：不是 failed，而是停在 paused 慢速轮询（前台每 slowRetryMs 一次）
    expect(h.state()).toMatchObject({
      phase: "paused",
      reason: "network",
      written: 300,
      retriesLeft: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 45));
    await flush();
    expect(h.tasks).toHaveLength(5);
    expect(h.tasks[4]?.resumeFrom).toBe(300);
    // 用户点"继续"：立刻再试，退避从头算
    h.tasks[4]!.reject(new Error("socket closed"));
    await flush();
    h.manager.start();
    await flush();
    expect(h.tasks[5]?.resumeFrom).toBe(300);
    expect(h.states.filter((s) => s.phase === "failed")).toHaveLength(0);
  });

  it("only integrity problems are terminal: a second size mismatch fails and does not auto-retry on foreground", async () => {
    const h = makeDeps(1_000);
    await h.manager.configure(h.target);
    h.manager.start();
    await flush();
    h.files.set(h.fileUri, 1_200);
    h.tasks[0]!.resolve(h.fileUri);
    await flush();
    await flush();
    // 第一次不符：删掉重下
    expect(h.tasks).toHaveLength(2);
    h.files.set(h.fileUri, 1_200);
    h.tasks[1]!.resolve(h.fileUri);
    await flush();
    await flush();
    expect(h.state()).toMatchObject({
      phase: "failed",
      error: "downloaded size does not match the release",
    });
    expect(h.files.has(h.fileUri)).toBe(false);
    h.setForeground(false);
    h.setForeground(true);
    await flush();
    expect(h.tasks).toHaveLength(2);
    // 用户点"重试下载"才重来，并且再给一次重下机会
    h.manager.start();
    await flush();
    expect(h.tasks).toHaveLength(3);
    expect(h.tasks[2]?.resumeFrom).toBeNull();
  });

  it("pauses a stalled transfer and resumes it when the app returns to the foreground", async () => {
    const h = makeDeps(1_000);
    await h.manager.configure(h.target);
    h.setForeground(false);
    h.manager.start();
    await flush();
    h.tasks[0]!.progress(100, 1_000);
    h.files.set(h.fileUri, 100);
    // 100ms 没有进度 → 停滞暂停；后台不自动重试
    await new Promise((resolve) => setTimeout(resolve, 130));
    await flush();
    expect(h.tasks[0]?.paused).toBe(true);
    expect(h.state()).toMatchObject({ phase: "paused", reason: "stalled" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.tasks).toHaveLength(1);
    // 回到前台立刻从 100 字节续传
    h.setForeground(true);
    await flush();
    expect(h.tasks).toHaveLength(2);
    expect(h.tasks[1]?.resumeFrom).toBe(100);
  });

  it("recovers on cold start: a complete file is ready, a partial file resumes, other releases are cleaned", async () => {
    const h = makeDeps(1_000);
    h.files.set(h.fileUri, 1_000);
    h.files.set(`${h.target.url}-old`, 5);
    h.files.set("file:///cache/apk-updates/release-rel_0.apk", 400);
    await h.manager.configure(h.target);
    expect(h.state()).toMatchObject({ phase: "ready", size: 1_000 });
    expect([...h.files.keys()]).toEqual([h.fileUri]);

    const partial = makeDeps(1_000);
    partial.files.set(partial.fileUri, 640);
    await partial.manager.configure(partial.target);
    await flush();
    expect(partial.state().phase).toBe("downloading");
    expect(partial.tasks[0]?.resumeFrom).toBe(640);
  });

  it("restarts once when the server ignored the range and the file came out the wrong size", async () => {
    const h = makeDeps(1_000);
    h.files.set(h.fileUri, 640);
    await h.manager.configure(h.target);
    await flush();
    // 服务端回了整包，追加后 1640 字节
    h.files.set(h.fileUri, 1_640);
    h.tasks[0]!.resolve(h.fileUri);
    await flush();
    await flush();
    expect(h.files.has(h.fileUri)).toBe(false);
    expect(h.tasks).toHaveLength(2);
    expect(h.tasks[1]?.resumeFrom).toBeNull();
  });

  it("drops the file and state when the target changes or disappears", async () => {
    const h = makeDeps(1_000);
    h.files.set(h.fileUri, 1_000);
    await h.manager.configure(h.target);
    expect(h.state().phase).toBe("ready");
    await h.manager.configure({ ...h.target, releaseId: "rel_2" });
    expect(h.files.has(h.fileUri)).toBe(false);
    expect(h.state().phase).toBe("idle");
    await h.manager.configure(null);
    expect(h.state().phase).toBe("idle");
  });

  it("never trusts the release id as a path and only downloads over https from the tenant origin", async () => {
    expect(apkFileName("../../etc/passwd")).toBe(
      "release-______etc_passwd.apk",
    );
    expect(apkFileName("rel_JHrSsfq0LQtaWX1o1NpZjg")).toBe(
      "release-rel_JHrSsfq0LQtaWX1o1NpZjg.apk",
    );
    expect(isAcceptableApkUrl("https://api.test/x.apk", ORIGIN)).toBe(true);
    expect(isAcceptableApkUrl("http://api.test/x.apk", ORIGIN)).toBe(false);
    expect(isAcceptableApkUrl("https://evil.test/x.apk", ORIGIN)).toBe(false);
    expect(isAcceptableApkUrl("not a url", ORIGIN)).toBe(false);
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const h = makeDeps(1_000);
    await h.manager.configure({ ...h.target, url: "http://api.test/x.apk" });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("refusing apk target"),
    );
    warn.mockRestore();
    h.manager.start();
    await flush();
    expect(h.tasks).toHaveLength(0);
    // 不是悄悄当作"没有更新"：失败态让用户与运营看得见
    expect(h.state()).toMatchObject({
      phase: "failed",
      error: "apk url is not https or not the tenant api origin",
    });
  });

  it("refuses a target from a foreign origin or without a sha256 to verify against", async () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const foreign = makeDeps(1_000);
    await foreign.manager.configure({
      ...foreign.target,
      url: "https://evil.test/v1/public/releases/rel_1/download",
    });
    expect(foreign.state()).toMatchObject({ phase: "failed" });
    expect(apkTargetRefusal({ ...foreign.target, sha256: null })).toBe(
      "release has no sha256 to verify the download against",
    );
    const unhashed = makeDeps(1_000);
    await unhashed.manager.configure({ ...unhashed.target, sha256: null });
    unhashed.manager.start();
    await flush();
    expect(unhashed.tasks).toHaveLength(0);
    expect(unhashed.state()).toMatchObject({
      phase: "failed",
      error: "release has no sha256 to verify the download against",
    });
    // bootstrap 每次重取都会 configure 一次：同一被拒目标只告警、上报一次
    const events: string[] = [];
    const restore = setUpdateTelemetrySink((event) => {
      events.push(event.stage);
    });
    warn.mockClear();
    await unhashed.manager.configure({ ...unhashed.target, sha256: null });
    await unhashed.manager.configure({ ...unhashed.target, sha256: null });
    expect(unhashed.state().phase).toBe("failed");
    expect(events).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    restore();
    warn.mockRestore();
  });

  it("deletes a downloaded file whose hash does not match, retries once, then fails without ever offering install", async () => {
    const h = makeDeps(1_000);
    await h.manager.configure(h.target);
    h.manager.start();
    await flush();
    h.files.set(h.fileUri, 1_000);
    h.digests.set(h.fileUri, "b".repeat(64));
    h.tasks[0]!.resolve(h.fileUri);
    await flush();
    await flush();
    // 大小对、摘要不对：删掉重下一次
    expect(h.files.has(h.fileUri)).toBe(false);
    expect(h.tasks).toHaveLength(2);
    h.files.set(h.fileUri, 1_000);
    h.tasks[1]!.resolve(h.fileUri);
    await flush();
    await flush();
    expect(h.state()).toMatchObject({
      phase: "failed",
      error: "downloaded file hash does not match the release",
    });
    expect(h.files.has(h.fileUri)).toBe(false);
    expect(h.installs).toEqual([]);
    expect(h.states.some((state) => state.phase === "ready")).toBe(false);
  });

  it("hashes a complete file found on cold start before offering it for install", async () => {
    const events: string[] = [];
    const restore = setUpdateTelemetrySink((event) => {
      events.push(event.stage);
    });
    const tampered = makeDeps(1_000);
    tampered.files.set(tampered.fileUri, 1_000);
    tampered.digests.set(tampered.fileUri, "c".repeat(64));
    await tampered.manager.configure(tampered.target);
    // 与下载完成后的路径一致：删除、失败态可见、上报
    expect(tampered.state()).toMatchObject({
      phase: "failed",
      error: "downloaded file hash does not match the release",
    });
    expect(tampered.files.has(tampered.fileUri)).toBe(false);
    expect(events).toContain("error");
    restore();

    const intact = makeDeps(1_000);
    intact.files.set(intact.fileUri, 1_000);
    await intact.manager.configure(intact.target);
    expect(intact.state()).toMatchObject({ phase: "ready", size: 1_000 });
  });

  it("accepts the digest regardless of hex case", () => {
    expect(digestMatches("ABCDEF", "abcdef")).toBe(true);
    expect(digestMatches("abcdef", "abcdee")).toBe(false);
  });
});
