import { FIXTURE_NOW } from "../features/predict/fixtures/events";

/**
 * 测试时钟：把 `Date.now()` 锚定到夹具日期，让渲染夹具数据的用例不随日历漂移。
 *
 * 生产代码只用 `Date.now()`（预测市场不依赖 Mock 时钟）；Mock 网关的 `mockNow()`
 * 在 clockOffsetMs=0 时也等于 `Date.now()`，所以界面与 Mock 网关看到同一个"现在"。
 * 用例需要快进时调 `travelTestClock`；setup 在每个用例前后重新锚定 / 还原。
 */
const realNow = Date.now.bind(Date);
let anchorMs = new Date(FIXTURE_NOW).getTime();
let startedAt = realNow();
let spy: jest.SpyInstance<number, []> | null = null;

export function anchorTestClock(anchorIso: string = FIXTURE_NOW): void {
  anchorMs = new Date(anchorIso).getTime();
  startedAt = realNow();
  spy?.mockRestore();
  spy = jest
    .spyOn(Date, "now")
    .mockImplementation(() => anchorMs + (realNow() - startedAt));
}

/** 把测试时钟向前（或向后）拨 `deltaMs` 毫秒；真实时间照常流逝。 */
export function travelTestClock(deltaMs: number): void {
  anchorMs += deltaMs;
}

export function restoreTestClock(): void {
  spy?.mockRestore();
  spy = null;
}
