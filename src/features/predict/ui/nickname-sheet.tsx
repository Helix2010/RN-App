import { forwardRef, useEffect, useState } from "react";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { fill } from "../../../core/i18n/format";
import { NICKNAME_MAX_LENGTH } from "../../../core/predict-platform/profile";
import {
  Body,
  PrimaryButton,
  SecondaryButton,
  Sheet,
  Stack,
  TextField,
  toast,
  type SheetHandle,
} from "../../../design-system";
import {
  usePredictProfile,
  useUpdatePredictProfile,
} from "../hooks/use-predict-account";

/**
 * 预测市场昵称面板：与网页版 `WalletButton` 的昵称输入一致（最长 32 字符，留空 = 清除，显示回平台化名）。
 * 需要平台登录；调用方在没登录时不打开这个面板而是引导去启用。
 */
export const NicknameSheet = forwardRef<SheetHandle, { address: string }>(
  function NicknameSheet({ address }, ref) {
    const { t } = useFoundationRuntime();
    const profile = usePredictProfile(address);
    const update = useUpdatePredictProfile(address);
    const [name, setName] = useState("");
    useEffect(() => {
      setName(profile.data?.name ?? "");
    }, [profile.data?.name]);
    const save = (value: string) =>
      update.mutate(
        { name: value },
        {
          onSuccess: () => {
            toast(t("predict.profile.saved"), "success");
            (ref as React.RefObject<SheetHandle | null>).current?.dismiss();
          },
          onError: (error) =>
            toast(
              error instanceof Error ? error.message : String(error),
              "error",
            ),
        },
      );
    return (
      <Sheet
        ref={ref}
        title={t("predict.profile.nickname")}
        closeLabel={t("common.close")}
        locked={update.isPending}
        testID="nickname-sheet"
      >
        <Stack gap="$3">
          <TextField
            value={name}
            onChangeText={(value) =>
              setName(value.slice(0, NICKNAME_MAX_LENGTH))
            }
            placeholder={t("predict.profile.placeholder")}
            accessibilityLabel={t("predict.profile.nickname")}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={NICKNAME_MAX_LENGTH}
            testID="nickname-input"
          />
          <Body fontSize={12}>
            {fill(t("predict.profile.hint"), { max: NICKNAME_MAX_LENGTH })} ·{" "}
            {name.length}/{NICKNAME_MAX_LENGTH}
          </Body>
          <PrimaryButton
            disabled={
              update.isPending || name.trim() === (profile.data?.name ?? "")
            }
            onPress={() => save(name)}
            testID="nickname-save"
          >
            {update.isPending
              ? t("common.processing")
              : t("predict.profile.save")}
          </PrimaryButton>
          {profile.data?.name ? (
            <SecondaryButton
              disabled={update.isPending}
              onPress={() => save("")}
              testID="nickname-clear"
            >
              {t("predict.profile.clear")}
            </SecondaryButton>
          ) : null}
        </Stack>
      </Sheet>
    );
  },
);
