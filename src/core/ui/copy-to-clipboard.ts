import * as Clipboard from "expo-clipboard";
import { toast } from "../../design-system";

/**
 * 复制并给反馈。
 *
 * 项目里原来有 5 处 `Clipboard.setStringAsync(...).then(...)` 都没有 `.catch`：
 * 剪贴板被系统拒绝时既没有成功提示、也没有失败提示，还留下一个未处理的
 * rejection。集中到一处，顺手把失败说清楚。
 */
export async function copyToClipboard(
  value: string,
  messages: { success: string; failure: string },
): Promise<void> {
  try {
    await Clipboard.setStringAsync(value);
    toast(messages.success, "success");
  } catch {
    toast(messages.failure, "error");
  }
}
