/**
 * 进入预测市场时的启用引导只弹一次：同一地址在一次 App 进程里不反复打断。
 * 用户点"稍后"之后，顶栏的"启用"按钮和账户页仍然能随时进入引导。
 */
const prompted = new Set<string>();

export function shouldPromptEnable(address: string): boolean {
  if (prompted.has(address)) return false;
  prompted.add(address);
  return true;
}

export function resetEnablePrompts(): void {
  prompted.clear();
}
