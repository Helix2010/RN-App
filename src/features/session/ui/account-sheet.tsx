import * as Clipboard from "expo-clipboard";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { shortenAddress } from "../../../core/i18n/format";
import {
  AppIcon,
  Badge,
  Body,
  IconButton,
  InlineText,
  Row,
  SecondaryButton,
  SectionTitle,
  Sheet,
  Stack,
  toast,
  type SheetHandle,
} from "../../../design-system";
import {
  useSwitchAccount,
  useWalletAccounts,
} from "../../wallet/hooks/use-wallet";
import { useSession, useSignOut } from "../hooks/use-session";
import { requestAuth } from "../model/auth-sheet-store";

/** 账户 sheet：当前地址、切换、复制、断开。 */
export const AccountSheet = forwardRef<SheetHandle, { onClosed?: () => void }>(
  function AccountSheet({ onClosed }, ref) {
    const { t } = useFoundationRuntime();
    const session = useSession();
    const accounts = useWalletAccounts();
    const switchAccount = useSwitchAccount();
    const signOut = useSignOut();
    const address = session.data?.address;
    const sheet = useRef<SheetHandle>(null);
    useImperativeHandle(ref, () => ({
      present: () => sheet.current?.present(),
      dismiss: () => sheet.current?.dismiss(),
    }));

    const copy = async (value: string) => {
      await Clipboard.setStringAsync(value);
      toast(t("account.copied"), "success");
    };

    return (
      <Sheet
        ref={ref}
        title={t("account.title")}
        closeLabel={t("common.close")}
        onDismiss={onClosed}
        testID="account-sheet"
      >
        <Stack gap="$2">
          {(accounts.data ?? []).map((account) => {
            const current = account.address === address;
            return (
              <Row
                key={account.address}
                alignItems="center"
                gap="$3"
                padding="$3"
                borderRadius="$4"
                backgroundColor="$surfaceVariant"
                borderWidth={current ? 1.5 : 0}
                borderColor="$primary"
                onPress={
                  current
                    ? undefined
                    : () => switchAccount.mutate(account.address)
                }
                accessibilityRole="button"
                accessibilityLabel={account.label}
                accessibilityState={{ selected: current }}
                pressStyle={{ opacity: 0.75 }}
              >
                <Stack
                  width={40}
                  height={40}
                  borderRadius={20}
                  backgroundColor={current ? "$primary" : "$surface"}
                  alignItems="center"
                  justifyContent="center"
                >
                  <InlineText
                    color={current ? "$onPrimary" : "$color"}
                    fontWeight="900"
                  >
                    {account.address.slice(2, 4).toUpperCase()}
                  </InlineText>
                </Stack>
                <Stack flex={1} gap="$0.5">
                  <Row alignItems="center" gap="$2">
                    <SectionTitle fontSize={15}>{account.label}</SectionTitle>
                    {current ? (
                      <Badge
                        paddingVertical={2}
                        borderWidth={0}
                        backgroundColor="$primary"
                      >
                        <InlineText
                          color="$onPrimary"
                          fontSize={10}
                          fontWeight="800"
                        >
                          {t("account.current")}
                        </InlineText>
                      </Badge>
                    ) : null}
                    {account.connector === "embedded" && !account.backedUp ? (
                      <Badge paddingVertical={2}>
                        <InlineText
                          color="$warning"
                          fontSize={10}
                          fontWeight="800"
                        >
                          {t("account.notBackedUp")}
                        </InlineText>
                      </Badge>
                    ) : null}
                  </Row>
                  <Body fontSize={12}>
                    {shortenAddress(account.address, 6, 4)} ·{" "}
                    {account.chains.length} chains
                  </Body>
                </Stack>
                <IconButton
                  label={t("account.copy")}
                  icon="content-copy"
                  size={22}
                  onPress={() => void copy(account.address)}
                />
                {!current ? (
                  <AppIcon
                    name="chevron-right"
                    size={20}
                    colorToken="textMuted"
                  />
                ) : null}
              </Row>
            );
          })}
          <Row gap="$2" marginTop="$1">
            <SecondaryButton
              flex={1}
              onPress={() => requestAuth()}
              testID="account-add"
            >
              {t("account.addWallet")}
            </SecondaryButton>
            <SecondaryButton
              flex={1}
              borderColor="$danger"
              color="$danger"
              disabled={signOut.isPending}
              onPress={() =>
                signOut.mutate(undefined, {
                  onSuccess: () => {
                    sheet.current?.dismiss();
                    toast(t("account.disconnected"), "info");
                  },
                })
              }
              testID="account-disconnect"
            >
              {t("account.disconnect")}
            </SecondaryButton>
          </Row>
        </Stack>
      </Sheet>
    );
  },
);
