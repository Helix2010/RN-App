import * as Device from "expo-device";
import { isDeviceEnrolled } from "./app-lock";

/**
 * 设备完整性信号（安全评审 N31）。
 *
 * 这**不是安全控制**。信号由客户端自报，被攻破的客户端当然可以说自己没 root——
 * 任何拿它做放行判定的设计都是自欺。它回答的是另一个问题：我们的用户里有多少人
 * 跑在 root 过的设备、模拟器、旁加载的包上？在此之前这个问题完全没有答案。
 *
 * 三态是有意的：`true` / `false` / `undefined`。探针本身会失败，而 expo-device 的
 * root 检测明确标着 experimental。把"探不出来"折成 `false`，统计出来的数就是假的
 * ——那比没有统计更坏，因为它看起来像个答案。
 */
export type DeviceIntegritySignals = {
  rooted?: boolean;
  emulator?: boolean;
  sideLoaded?: boolean;
  devBundle?: boolean;
  /**
   * 这台设备有没有锁屏或生物识别（安全评审 N10）。
   *
   * `false` 意味着金库的身份验证判为"不可用"而放行——密钥在静止态仍然是加密的，
   * 但没有任何一步会问"是不是本人"。我们**不禁止**这类设备创建或导入钱包：把人
   * 锁在门外换不来安全，他只会换一个更糟的地方放助记词。但这件事必须能被数出来，
   * 否则"有多少用户实际上没有这道门"永远没有答案。
   */
  screenLock?: boolean;
};

/** 探针失败一律返回 undefined：不知道就说不知道，不要猜一个 false 出来。 */
async function probe(
  run: () => Promise<boolean>,
): Promise<boolean | undefined> {
  try {
    return await run();
  } catch {
    return undefined;
  }
}

/**
 * 采集一次信号。**永不抛错**：这是遥测，它挂掉不该连累心跳，而心跳挂掉会让一台
 * 设备在管理端整个消失。
 */
export async function collectDeviceIntegrity(): Promise<DeviceIntegritySignals> {
  const [rooted, sideLoaded, screenLock] = await Promise.all([
    probe(() => Device.isRootedExperimentalAsync()),
    probe(() => Device.isSideLoadingEnabledAsync()),
    probe(() => isDeviceEnrolled()),
  ]);
  let emulator: boolean | undefined;
  try {
    // isDevice 是同步属性，取不到时也当作"不知道"
    emulator =
      typeof Device.isDevice === "boolean" ? !Device.isDevice : undefined;
  } catch {
    emulator = undefined;
  }
  return {
    rooted,
    emulator,
    sideLoaded,
    screenLock,
    // 构建期常量：发布包里恒为 false。上报它是为了在管理端一眼分出"这台设备在跑
    // 开发包"，那类设备的其它信号都不该被当成生产事实
    devBundle: typeof __DEV__ === "boolean" ? __DEV__ : undefined,
  };
}

/** 每一项都探不出来时不必上报——服务端会把它与"旧版 App 没上报"存成同一个 NULL。 */
export function hasAnySignal(signals: DeviceIntegritySignals): boolean {
  return Object.values(signals).some((value) => value !== undefined);
}
