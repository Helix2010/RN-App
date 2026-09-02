/**
 * expo-camera 的测试替身。
 *
 * `CameraView` 渲染成一个把 `onBarcodeScanned` 原样挂在 props 上的 View，测试用
 * `fireEvent(view, "barcodeScanned", { data })` 模拟扫到一个码；权限状态由
 * `setCameraPermission` 控制，缺省已授权。
 */
import { createElement } from "react";
import { View } from "react-native";

type Permission = {
  granted: boolean;
  status: "granted" | "denied" | "undetermined";
  canAskAgain: boolean;
};

let permission: Permission = {
  granted: true,
  status: "granted",
  canAskAgain: true,
};

export function setCameraPermission(next: Permission): void {
  permission = next;
}

export function resetCameraPermission(): void {
  permission = { granted: true, status: "granted", canAskAgain: true };
}

export const requestCameraPermissionsAsync = jest.fn(async () => permission);

export function useCameraPermissions(): [
  Permission,
  () => Promise<Permission>,
] {
  return [permission, requestCameraPermissionsAsync];
}

export function CameraView(props: {
  testID?: string;
  onBarcodeScanned?: (result: { data: string }) => void;
  children?: unknown;
}) {
  return createElement(View, {
    testID: props.testID,
    onBarcodeScanned: props.onBarcodeScanned,
  } as Record<string, unknown>);
}
