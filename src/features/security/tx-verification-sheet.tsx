import { forwardRef } from "react";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  usePreferencesStore,
  type TxVerificationPolicy,
} from "../../core/preferences/preferences-store";
import { RadioRow, Sheet, type SheetHandle } from "../../design-system";

const POLICIES: TxVerificationPolicy[] = ["smart", "always", "off"];

/** 当前策略的显示名（设置页 / 安全中心的值列） */
export function useTxVerificationLabel(): string {
  const { t } = useFoundationRuntime();
  const policy = usePreferencesStore((state) => state.txVerification);
  return t(`security.txVerification.${policy}`);
}

/**
 * 交易前验证策略选择（智能 / 每次双重验证 / 关闭）。
 * 三个选项各带一句说明，选中即生效并收起。
 */
export const TxVerificationSheet = forwardRef<SheetHandle, object>(
  function TxVerificationSheet(_props, ref) {
    const { t } = useFoundationRuntime();
    const policy = usePreferencesStore((state) => state.txVerification);
    const update = usePreferencesStore((state) => state.update);
    return (
      <Sheet
        ref={ref}
        title={t("settings.txConfirm")}
        subtitle={t("security.txConfirm.hint")}
        closeLabel={t("common.close")}
        testID="tx-verification-sheet"
      >
        {POLICIES.map((option) => (
          <RadioRow
            key={option}
            label={t(`security.txVerification.${option}`)}
            description={t(`security.txVerification.${option}.hint`)}
            selected={policy === option}
            onPress={() => {
              update({ txVerification: option });
              (ref as React.RefObject<SheetHandle | null>).current?.dismiss();
            }}
            testID={`tx-verification-${option}`}
          />
        ))}
      </Sheet>
    );
  },
);
