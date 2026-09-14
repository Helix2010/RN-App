/**
 * 关于 > 版本信息里「OTA 修订」这一行该显示什么（设计 diagnostic-report-2026-09-14 §7.1）。
 *
 * 这一行替代了原来那串 expo-updates 的 update id：UUID 用户看不懂、管理端也搜不到，
 * 而修订号 `rev N` 两边都认。bootstrap 已经下发了服务端最新那条 OTA 的修订号和 update id，
 * 只有两者对得上，才能说"本机正在跑的就是 rev N"。
 */
export type OtaRevisionState =
  | { kind: "embedded" }
  | { kind: "revision"; revision: number }
  | { kind: "pending"; revision: number }
  | { kind: "unknown" };

export function otaRevisionState(
  running: { isEmbedded: boolean; updateId: string | null },
  delivered: { revision?: number | null; updateId?: string | null },
): OtaRevisionState {
  if (running.isEmbedded) return { kind: "embedded" };
  const revision = delivered.revision ?? null;
  if (
    revision !== null &&
    running.updateId &&
    running.updateId === delivered.updateId
  )
    return { kind: "revision", revision };
  // 跑的是某个 OTA，但不是服务端现在下发的那一条：大概率新包已下载、等下次启动
  if (revision !== null) return { kind: "pending", revision };
  return { kind: "unknown" };
}
