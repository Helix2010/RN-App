import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { useGateways } from "../../../core/gateways/gateway-context";
import { shortenAddress } from "../../../core/i18n/format";
import {
  AppIcon,
  Badge,
  Body,
  Content,
  InlineText,
  Label,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  ScreenHeader,
  SecondaryButton,
  Sheet,
  type SheetHandle,
  Stack,
  TextField,
  toast,
} from "../../../design-system";
import type { RootStackParamList } from "../../../navigation/types";
import { SRow } from "../../profile/profile-screen";
import { useSession } from "../../session/hooks/use-session";
import { requestAuth } from "../../session/model/auth-sheet-store";
import { useSwitchAccount, useWalletAccounts } from "../hooks/use-wallet";

function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    template,
  );
}

/** S-09 钱包管理：当前使用 / 其他钱包 单选切换；当前钱包操作组；添加钱包复用 L-02。 */
export function WalletsScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Wallets">) {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  const session = useSession();
  const address = session.data?.address;
  const accounts = useWalletAccounts();
  const switchAccount = useSwitchAccount();
  const { wallet } = useGateways();
  const queryClient = useQueryClient();
  const rename = useRef<SheetHandle>(null);
  const disconnect = useRef<SheetHandle>(null);
  const [label, setLabel] = useState("");
  const current = (accounts.data ?? []).find(
    (item) => item.address === address,
  );
  const others = (accounts.data ?? []).filter(
    (item) => item.address !== address,
  );
  const currentLabel =
    session.data?.ens ??
    current?.label ??
    (address ? shortenAddress(address) : "");

  const onSwitch = (target: string, targetLabel: string) => {
    switchAccount.mutate(target, {
      onSuccess: () => {
        toast(fill(t("wallets.switched"), { label: targetLabel }), "info");
        navigation.popToTop();
        requestAuth();
      },
    });
  };
  const saveLabel = async () => {
    if (!address || !label.trim()) return;
    await wallet.rename(address, label.trim());
    void queryClient.invalidateQueries({ queryKey: ["wallet-accounts"] });
    rename.current?.dismiss();
    toast(t("wallets.renamed"), "success");
  };
  const onDisconnect = async () => {
    if (!address) return;
    await wallet.disconnect(address);
    void queryClient.invalidateQueries({ queryKey: ["wallet-accounts"] });
    disconnect.current?.dismiss();
    const next = others[0];
    if (next) onSwitch(next.address, next.label);
    else {
      queryClient.setQueryData(["session"], null);
      navigation.popToTop();
    }
  };

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("wallets.title")}
          onBack={() => navigation.goBack()}
          backLabel={t("action.back")}
        />
      </Content>
      <PageScroll>
        <Content paddingTop="$1" gap="$4" paddingBottom={120}>
          <Stack gap="$1.5">
            <Label>{t("wallets.current")}</Label>
            {current ? (
              <WalletRow
                label={currentLabel}
                address={current.address}
                connector={t(`profile.connector.${current.connector}`)}
                chains={fill(t("profile.chains"), { n: current.chains.length })}
                selected
                notBackedUp={
                  current.connector === "embedded" && !current.backedUp
                    ? t("wallets.notBackedUp")
                    : undefined
                }
                testID={`wallets-item-${current.connector}`}
              />
            ) : null}
          </Stack>
          {others.length ? (
            <Stack gap="$1.5">
              <Label>{t("wallets.others")}</Label>
              {others.map((item) => (
                <WalletRow
                  key={item.address}
                  label={item.label}
                  address={item.address}
                  connector={t(`profile.connector.${item.connector}`)}
                  chains={fill(t("profile.chains"), { n: item.chains.length })}
                  notBackedUp={
                    item.connector === "embedded" && !item.backedUp
                      ? t("wallets.notBackedUp")
                      : undefined
                  }
                  onPress={() => onSwitch(item.address, item.label)}
                  testID={`wallets-item-${item.connector}`}
                />
              ))}
            </Stack>
          ) : null}
          {address ? (
            <Stack gap="$1.5">
              <Label>
                {fill(t("wallets.actions"), { label: currentLabel })}
              </Label>
              <Stack
                borderRadius="$4"
                backgroundColor="$surface"
                borderWidth={1}
                borderColor="$borderColor"
                paddingHorizontal="$3"
              >
                <SRow
                  icon="content-copy"
                  title={t("wallets.copy")}
                  onPress={() =>
                    void Clipboard.setStringAsync(address).then(() =>
                      toast(t("receive.copied"), "success"),
                    )
                  }
                  testID="wallets-copy"
                />
                <SRow
                  icon="pencil-outline"
                  title={t("wallets.rename")}
                  value={current?.label}
                  onPress={() => {
                    setLabel(current?.label ?? "");
                    rename.current?.present();
                  }}
                  testID="wallets-rename"
                />
                <SRow
                  icon="open-in-new"
                  title={t("wallets.explorer")}
                  onPress={() =>
                    void Clipboard.setStringAsync(
                      `https://bscscan.com/address/${address}`,
                    ).then(() => toast(t("receive.copied"), "success"))
                  }
                  testID="wallets-explorer"
                />
                <SRow
                  icon="link-off"
                  title={t("wallets.disconnect")}
                  danger
                  onPress={() => disconnect.current?.present()}
                  testID="wallets-disconnect"
                />
              </Stack>
            </Stack>
          ) : null}
          <Body fontSize={12}>{t("wallets.hint")}</Body>
        </Content>
      </PageScroll>
      <Stack
        position="absolute"
        left={0}
        right={0}
        bottom={0}
        padding="$4"
        paddingBottom={insets.bottom + 12}
        backgroundColor="$background"
        borderTopWidth={1}
        borderColor="$borderColor"
      >
        <PrimaryButton onPress={() => requestAuth()} testID="wallets-add-btn">
          {t("wallets.add")}
        </PrimaryButton>
      </Stack>
      <Sheet
        ref={rename}
        title={t("wallets.rename")}
        closeLabel={t("common.close")}
      >
        <TextField
          value={label}
          onChangeText={setLabel}
          placeholder={current?.label}
          accessibilityLabel={t("wallets.rename")}
          testID="wallets-rename-input"
        />
        <PrimaryButton
          onPress={() => void saveLabel()}
          testID="wallets-rename-save"
        >
          {t("common.save")}
        </PrimaryButton>
      </Sheet>
      <Sheet
        ref={disconnect}
        title={fill(t("wallets.disconnectConfirm"), { label: currentLabel })}
        closeLabel={t("common.close")}
      >
        <PrimaryButton
          backgroundColor="$danger"
          onPress={() => void onDisconnect()}
          testID="wallets-disconnect-confirm"
        >
          {t("wallets.disconnect")}
        </PrimaryButton>
        <SecondaryButton onPress={() => disconnect.current?.dismiss()}>
          {t("common.cancel")}
        </SecondaryButton>
      </Sheet>
    </Page>
  );
}

function WalletRow({
  label,
  address,
  connector,
  chains,
  selected,
  notBackedUp,
  onPress,
  testID,
}: {
  label: string;
  address: string;
  connector: string;
  chains: string;
  selected?: boolean;
  notBackedUp?: string;
  onPress?: () => void;
  testID: string;
}) {
  return (
    <Row
      alignItems="center"
      gap="$3"
      padding="$3"
      borderRadius="$4"
      backgroundColor="$surfaceVariant"
      borderWidth={selected ? 1.5 : 0}
      borderColor="$primary"
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      testID={testID}
      pressStyle={onPress ? { opacity: 0.75 } : undefined}
    >
      <Stack
        width={40}
        height={40}
        borderRadius={20}
        backgroundColor={selected ? "$primary" : "$surface"}
        alignItems="center"
        justifyContent="center"
      >
        <InlineText color={selected ? "$onPrimary" : "$color"} fontWeight="900">
          {address.slice(2, 4).toUpperCase()}
        </InlineText>
      </Stack>
      <Stack flex={1} gap="$0.5">
        <Row alignItems="center" gap="$2">
          <InlineText fontSize={15} fontWeight="700">
            {label}
          </InlineText>
          {notBackedUp ? (
            <Badge paddingVertical={2}>
              <InlineText fontSize={10} fontWeight="800" color="$warning">
                {notBackedUp}
              </InlineText>
            </Badge>
          ) : null}
        </Row>
        <Body fontSize={12}>
          {shortenAddress(address)} · {connector} · {chains}
        </Body>
      </Stack>
      <Stack
        width={22}
        height={22}
        borderRadius={11}
        borderWidth={2}
        borderColor={selected ? "$primary" : "$borderColor"}
        alignItems="center"
        justifyContent="center"
      >
        {selected ? (
          <Stack
            width={12}
            height={12}
            borderRadius={6}
            backgroundColor="$primary"
          />
        ) : null}
      </Stack>
      {!selected ? (
        <AppIcon name="chevron-right" size={18} colorToken="textMuted" />
      ) : null}
    </Row>
  );
}
