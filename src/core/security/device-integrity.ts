import * as Device from "expo-device";

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
  const [rooted, sideLoaded] = await Promise.all([
    probe(() => Device.isRootedExperimentalAsync()),
    probe(() => Device.isSideLoadingEnabledAsync()),
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
    // 构建期常量：发布包里恒为 false。上报它是为了在管理端一眼分出"这台设备在跑
    // 开发包"，那类设备的其它信号都不该被当成生产事实
    devBundle: typeof __DEV__ === "boolean" ? __DEV__ : undefined,
  };
}

/** 每一项都探不出来时不必上报——服务端会把它与"旧版 App 没上报"存成同一个 NULL。 */
export function hasAnySignal(signals: DeviceIntegritySignals): boolean {
  return Object.values(signals).some((value) => value !== undefined);
}
