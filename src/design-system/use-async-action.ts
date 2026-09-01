import { useCallback, useRef, useState } from "react";
import { toast } from "./toast";

/**
 * 有反馈的异步操作。
 *
 * 存在的理由：这个项目里"点了没反馈"是系统性的——Tamagui 的 Button 没有
 * `loading`，所以每个调用点都得自己手写 `disabled={pending}` 和 try/catch，
 * 漏一个就变成静默失败（钱包管理里一次漏了五处）。用这个 hook，
 * **进行中状态和失败提示是默认行为，而不是每次都要记得写的东西**。
 *
 * 成功提示是可选的：有些操作成功后会导航走或关闭 sheet，再弹一条反而吵。
 *
 * action 里带守卫（`if (!x) return`）时要返回 `false`，否则会弹一条"已完成"
 * 而其实什么都没做——这个坑我自己第一次用就踩了。
 */
export function useAsyncAction<TArgs extends unknown[]>(
  action: (...args: TArgs) => Promise<void | false>,
  options: {
    /** 失败时给用户看的话。必填——静默失败正是要消灭的东西 */
    failureMessage: string;
    successMessage?: string;
    onError?: (error: unknown) => void;
  },
): { run: (...args: TArgs) => void; pending: boolean } {
  const [pending, setPending] = useState(false);
  // 用 ref 挡重复点击：setState 是异步的，连点两次会都读到旧的 false
  const running = useRef(false);
  const { failureMessage, successMessage, onError } = options;

  const run = useCallback(
    (...args: TArgs) => {
      if (running.current) return;
      running.current = true;
      setPending(true);
      void action(...args)
        .then((outcome) => {
          // 返回 false = 守卫拦下了，什么都没做，别报成功
          if (outcome !== false && successMessage)
            toast(successMessage, "success");
        })
        .catch((error: unknown) => {
          toast(failureMessage, "error");
          onError?.(error);
        })
        .finally(() => {
          running.current = false;
          setPending(false);
        });
    },
    [action, failureMessage, onError, successMessage],
  );

  return { run, pending };
}
