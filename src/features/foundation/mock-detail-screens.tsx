import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState } from "react";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  AmountText,
  Badge,
  Body,
  Card,
  Content,
  InlineText,
  Label,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  ScreenHeader,
  SectionTitle,
  Stack,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";
import { useEdgeBackGesture } from "../../navigation/edge-back-gesture";
import {
  mockAccount,
  mockDexToken,
  mockPredictEvent,
  mockSecurity,
  mockSwapHistory,
  mockText,
  mockTransfer,
  mockNotificationSettings,
  mockProfile,
} from "../demo-data";

type DetailRoute =
  | "PredictEvent"
  | "PredictOrder"
  | "PredictSettlement"
  | "DexToken"
  | "Swap"
  | "SwapHistory"
  | "Transfer"
  | "AccountDetail"
  | "NotificationSettings"
  | "About"
  | "SecurityCenter";
type Props<R extends DetailRoute> = NativeStackScreenProps<
  RootStackParamList,
  R
>;

function DetailPage({
  title,
  navigation,
  children,
}: {
  title: string;
  navigation: { goBack: () => void };
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  const edgeBack = useEdgeBackGesture(navigation.goBack);
  return (
    <Page {...edgeBack}>
      <PageScroll>
        <Content paddingTop={insets.top + 16}>
          <ScreenHeader
            title={title}
            onBack={() => navigation.goBack()}
            backLabel={t("action.back")}
          />
          {children}
        </Content>
      </PageScroll>
    </Page>
  );
}
function DataRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "$success" | "$danger" | "$warning" | "$info";
}) {
  return (
    <Row justifyContent="space-between" gap="$3">
      <Body>{label}</Body>
      <InlineText
        color={color ?? "$color"}
        fontWeight="700"
        textAlign="right"
        flexShrink={1}
      >
        {value}
      </InlineText>
    </Row>
  );
}

export function PredictEventScreen({ navigation }: Props<"PredictEvent">) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  return (
    <DetailPage title={t("predict.event.title")} navigation={navigation}>
      <Card shadowOpacity={0}>
        <Badge>
          <InlineText color="$success">
            {t(`predict.event.${mockPredictEvent.status}`)}
          </InlineText>
        </Badge>
        <SectionTitle>
          {mockText(mockPredictEvent.question, locale)}
        </SectionTitle>
        <Body>{mockText(mockPredictEvent.meta, locale)}</Body>
        <AmountText color="$success">{mockPredictEvent.probability}</AmountText>
        <Body>{t("predict.event.probability")}</Body>
      </Card>
      <Card shadowOpacity={0}>
        <Label>{t("predict.event.orderbook")}</Label>
        <DataRow
          label={`${mockPredictEvent.yesLabel} ${mockPredictEvent.yesPrice}`}
          value={mockPredictEvent.yesDepth}
          color="$success"
        />
        <DataRow
          label={`${mockPredictEvent.noLabel} ${mockPredictEvent.noPrice}`}
          value={mockPredictEvent.noDepth}
          color="$danger"
        />
      </Card>
      <Card shadowOpacity={0}>
        <Label>{t("predict.event.rules")}</Label>
        <Body>{mockText(mockPredictEvent.rules, locale)}</Body>
      </Card>
      <Row gap="$2">
        <PrimaryButton
          flex={1}
          backgroundColor="$success"
          onPress={() => navigation.navigate("PredictOrder", { side: "yes" })}
        >
          {t("predict.buyYes")}
        </PrimaryButton>
        <PrimaryButton
          flex={1}
          backgroundColor="$danger"
          onPress={() => navigation.navigate("PredictOrder", { side: "no" })}
        >
          {t("predict.buyNo")}
        </PrimaryButton>
      </Row>
    </DetailPage>
  );
}

export function PredictOrderScreen({
  navigation,
  route,
}: Props<"PredictOrder">) {
  const { config, t } = useFoundationRuntime();
  const [amount, setAmount] = useState("50 USDT");
  const side = route.params.side;
  return (
    <DetailPage title={t("predict.order.title")} navigation={navigation}>
      <Card shadowOpacity={0}>
        <Label>{t("predict.order.market")}</Label>
        <SectionTitle>
          {mockText(
            mockPredictEvent.question,
            config.localization.selectedLocale,
          )}
        </SectionTitle>
        <Badge>
          <InlineText color={side === "yes" ? "$success" : "$danger"}>
            {side === "yes" ? t("predict.buyYes") : t("predict.buyNo")}
          </InlineText>
        </Badge>
      </Card>
      <Card shadowOpacity={0}>
        <Label>{t("predict.order.amount")}</Label>
        <Row gap="$2">
          {["10 USDT", "50 USDT", "100 USDT"].map((preset) => (
            <PrimaryButton
              key={preset}
              flex={1}
              height={42}
              backgroundColor={
                amount === preset ? "$primary" : "$surfaceVariant"
              }
              color={amount === preset ? "$onPrimary" : "$color"}
              onPress={() => setAmount(preset)}
            >
              {preset}
            </PrimaryButton>
          ))}
        </Row>
        <DataRow label={t("predict.order.estimated")} value={amount} />
      </Card>
      <PrimaryButton onPress={() => navigation.navigate("PredictSettlement")}>
        {t("predict.order.confirm")}
      </PrimaryButton>
    </DetailPage>
  );
}

export function PredictSettlementScreen({
  navigation,
}: Props<"PredictSettlement">) {
  const { t } = useFoundationRuntime();
  return (
    <DetailPage title={t("predict.settlement.title")} navigation={navigation}>
      <Card backgroundColor="$surfaceVariant" shadowOpacity={0}>
        <Badge>
          <InlineText color="$success">
            {t("predict.settlement.settled")}
          </InlineText>
        </Badge>
        <SectionTitle>{t("predict.settlement.description")}</SectionTitle>
        <AmountText color="$success">+58.40 USDT</AmountText>
      </Card>
      <Card shadowOpacity={0}>
        <DataRow
          label={t("predict.settlement.result")}
          value={t("predict.settlement.won")}
          color="$success"
        />
        <DataRow label={t("predict.settlement.payout")} value="58.40 USDT" />
      </Card>
      <PrimaryButton onPress={() => navigation.goBack()}>
        {t("predict.settlement.done")}
      </PrimaryButton>
    </DetailPage>
  );
}

export function DexTokenScreen({ navigation }: Props<"DexToken">) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  return (
    <DetailPage title={mockDexToken.symbol} navigation={navigation}>
      <Card shadowOpacity={0}>
        <Row justifyContent="space-between">
          <Stack>
            <Label>{mockDexToken.pair}</Label>
            <AmountText>{mockDexToken.price}</AmountText>
          </Stack>
          <Badge>
            <InlineText color="$success">{mockDexToken.change}</InlineText>
          </Badge>
        </Row>
        <Body>
          {t("dex.token.chain")}: {mockDexToken.chain} · {mockDexToken.address}
        </Body>
      </Card>
      <Card shadowOpacity={0}>
        <Label>{t("dex.token.stats")}</Label>
        <DataRow
          label={t("dex.token.marketCap")}
          value={mockDexToken.marketCap}
        />
        <DataRow
          label={t("dex.token.liquidity")}
          value={mockDexToken.liquidity}
        />
        <DataRow label={t("dex.token.volume")} value={mockDexToken.volume} />
      </Card>
      <Card shadowOpacity={0}>
        <Row justifyContent="space-between">
          <SectionTitle>{t("dex.token.security")}</SectionTitle>
          <Badge>
            <InlineText color="$success">
              {mockDexToken.securityScore}
            </InlineText>
          </Badge>
        </Row>
        <Body>{mockText(mockDexToken.securitySummary, locale)}</Body>
      </Card>
      <PrimaryButton onPress={() => navigation.navigate("Swap")}>
        {t("dex.token.swap")}
      </PrimaryButton>
    </DetailPage>
  );
}

export function SwapDetailScreen({ navigation }: Props<"Swap">) {
  const { t } = useFoundationRuntime();
  return (
    <DetailPage title={t("module.swap.title")} navigation={navigation}>
      <Card shadowOpacity={0}>
        <Label>{t("module.swap.pay")}</Label>
        <AmountText>250.00 USDC</AmountText>
        <Body>{t("module.swap.balancePrefix")} 1,560.50 USDC</Body>
      </Card>
      <Card shadowOpacity={0}>
        <Label>{t("module.swap.receiveEstimated")}</Label>
        <AmountText>0.095 ETH</AmountText>
        <DataRow
          label={t("module.swap.detail.rate")}
          value="1 USDC = 0.00038 ETH"
        />
        <DataRow label={t("module.swap.detail.networkFee")} value="0.42 USDC" />
      </Card>
      <PrimaryButton onPress={() => navigation.goBack()}>
        {t("module.swap.submit")}
      </PrimaryButton>
    </DetailPage>
  );
}

export function SwapHistoryScreen({ navigation }: Props<"SwapHistory">) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  return (
    <DetailPage title={t("swap.history.title")} navigation={navigation}>
      {mockSwapHistory.map((item) => (
        <Card key={item.pair} shadowOpacity={0}>
          <Row justifyContent="space-between">
            <SectionTitle>{item.pair}</SectionTitle>
            <Badge>
              <InlineText
                color={
                  item.status === "success"
                    ? "$success"
                    : item.status === "failed"
                      ? "$danger"
                      : "$info"
                }
              >
                {t(`swap.status.${item.status}`)}
              </InlineText>
            </Badge>
          </Row>
          <Body>{item.amount}</Body>
          <Body>{mockText(item.timestamp, locale)}</Body>
        </Card>
      ))}
    </DetailPage>
  );
}

export function TransferScreen({ navigation }: Props<"Transfer">) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  return (
    <DetailPage title={t("assets.transfer")} navigation={navigation}>
      <Card shadowOpacity={0}>
        <DataRow
          label={t("assets.transfer.from")}
          value={mockText(mockTransfer.from, locale)}
        />
        <DataRow
          label={t("assets.transfer.to")}
          value={mockText(mockTransfer.to, locale)}
        />
      </Card>
      <Card shadowOpacity={0}>
        <Label>{t("assets.transfer.amount")}</Label>
        <AmountText>{mockTransfer.amount}</AmountText>
        <Body>
          {mockTransfer.currency} · {t("assets.transfer.available")}{" "}
          {mockTransfer.available}
        </Body>
      </Card>
      <PrimaryButton>{t("assets.transfer.confirm")}</PrimaryButton>
    </DetailPage>
  );
}

export function AccountDetailScreen({ navigation }: Props<"AccountDetail">) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  return (
    <DetailPage title={t("assets.accountDetail")} navigation={navigation}>
      <Card backgroundColor="$primary" shadowOpacity={0}>
        <Label color="$onPrimary">{mockText(mockAccount.title, locale)}</Label>
        <AmountText color="$onPrimary">{mockAccount.balance}</AmountText>
        <Body color="$onPrimary">{mockText(mockAccount.subtitle, locale)}</Body>
      </Card>
      <Card shadowOpacity={0}>
        {mockAccount.assets.map((asset) => (
          <DataRow
            key={asset.labelKey ?? asset.label}
            label={asset.labelKey ? t(asset.labelKey) : (asset.label ?? "")}
            value={asset.value}
          />
        ))}
      </Card>
    </DetailPage>
  );
}

export function NotificationSettingsScreen({
  navigation,
}: Props<"NotificationSettings">) {
  const { t } = useFoundationRuntime();
  return (
    <DetailPage title={t("notif.title")} navigation={navigation}>
      {mockNotificationSettings.map((item) => (
        <Card key={item.key} shadowOpacity={0}>
          <Row justifyContent="space-between">
            <SectionTitle>{t(`notif.${item.key}`)}</SectionTitle>
            <InlineText color={item.enabled ? "$primary" : "$textMuted"}>
              {item.enabled ? "●" : "○"}
            </InlineText>
          </Row>
        </Card>
      ))}
    </DetailPage>
  );
}

export function AboutScreen({ navigation }: Props<"About">) {
  const { config, t } = useFoundationRuntime();
  return (
    <DetailPage title={t("about.title")} navigation={navigation}>
      <Stack alignItems="center" gap="$2" padding="$4">
        <Stack
          width={72}
          height={72}
          borderRadius="$5"
          backgroundColor="$primary"
          alignItems="center"
          justifyContent="center"
        >
          <InlineText color="$onPrimary" fontSize={28} fontWeight="900">
            {mockProfile.displayName.slice(0, 1)}
          </InlineText>
        </Stack>
        <SectionTitle>{t("app.name")}</SectionTitle>
        <Body>
          {config.app.version} ({config.app.buildNumber})
        </Body>
      </Stack>
      <Card shadowOpacity={0}>
        <SectionTitle>
          {config.update.decision === "none"
            ? t("about.upToDate")
            : t("update.noticeTitle")}
        </SectionTitle>
        <Body>{config.update.releaseNotes.join("\n")}</Body>
        <PrimaryButton>{t("settings.checkUpdate")}</PrimaryButton>
      </Card>
    </DetailPage>
  );
}

export function SecurityCenterScreen({ navigation }: Props<"SecurityCenter">) {
  const { t } = useFoundationRuntime();
  return (
    <DetailPage title={t("security.title")} navigation={navigation}>
      <Card shadowOpacity={0}>
        <Label>{t("security.level")}</Label>
        <AmountText color="$success">
          {t(`security.level.${mockSecurity.level}`)}
        </AmountText>
        <Body>
          {mockSecurity.protections} {t("security.protections")}
        </Body>
      </Card>
      <Card shadowOpacity={0}>
        <DataRow label={t("security.password")} value={t("settings.enabled")} />
        <DataRow label={t("security.email")} value={mockSecurity.email} />
        <DataRow
          label={t("security.totp")}
          value={t("security.bound")}
          color="$success"
        />
        <DataRow
          label={t("security.antiPhishing")}
          value={t("security.notSet")}
          color="$warning"
        />
      </Card>
      <Card shadowOpacity={0}>
        <DataRow label={t("security.devices")} value={mockSecurity.devices} />
        <DataRow label={t("security.loginHistory")} value="›" />
        <DataRow
          label={t("security.addressBook")}
          value={mockSecurity.addresses}
        />
      </Card>
    </DetailPage>
  );
}
