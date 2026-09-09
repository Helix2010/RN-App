import {
  ApkDownloadManager,
  apkFileName,
  isAcceptableApkUrl,
  type ApkDownloadDeps,
  type ApkDownloadState,
  type ApkDownloadTask,
} from "./apk-download-manager";

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
    isForeground: () => foreground,
    onForeground: (listener) => {
      foregroundListeners.add(listener);
      return () => foregroundListeners.delete(listener);
    },
    now: () => now,
    stallMs: 100,
    retryDelaysMs: [10, 20, 30],
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
  const target = {
    releaseId: "rel_1",
    url: "https://api.test/v1/public/releases/rel_1/download",
    size,
  };
  const fileUri = `${directory}release-rel_1.apk`;
  return {
    manager,
    target,
    fileUri,
    files,
    tasks,
    installs,
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

  it("resumes from the bytes already on disk after a network error, with backoff, then gives up", async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 35));
    await flush();
    h.tasks[3]!.reject(new Error("socket closed"));
    await flush();
    // 三次退避用完：交给用户
    expect(h.state()).toMatchObject({ phase: "failed", written: 300 });
    h.manager.start();
    await flush();
    expect(h.tasks[4]?.resumeFrom).toBe(300);
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

  it("never trusts the release id as a path and only downloads over https", async () => {
    expect(apkFileName("../../etc/passwd")).toBe(
      "release-______etc_passwd.apk",
    );
    expect(apkFileName("rel_JHrSsfq0LQtaWX1o1NpZjg")).toBe(
      "release-rel_JHrSsfq0LQtaWX1o1NpZjg.apk",
    );
    expect(isAcceptableApkUrl("https://api.test/x.apk")).toBe(true);
    expect(isAcceptableApkUrl("http://api.test/x.apk")).toBe(false);
    const h = makeDeps(1_000);
    await h.manager.configure({ ...h.target, url: "http://api.test/x.apk" });
    h.manager.start();
    await flush();
    expect(h.tasks).toHaveLength(0);
    expect(h.state().phase).toBe("idle");
  });
});
