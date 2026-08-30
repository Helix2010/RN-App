import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  AppHeader,
  Body,
  Card,
  Content,
  HairlineCard,
  Label,
  Page,
  PageScroll,
  SectionTitle,
  Stack,
} from "../../design-system";

export type ModuleOverviewKind =
  "predict" | "positions" | "dex" | "market" | "swap";

export function ModuleOverviewScreen({ kind }: { kind: ModuleOverviewKind }) {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  const isPredict = kind === "predict" || kind === "positions";
  const title = t(`module.${kind}.title`);
  const description = t(`module.${kind}.description`);

  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 24}>
          <AppHeader title={title} subtitle={description} />
          <Card backgroundColor="$primary" shadowOpacity={0}>
            <Label color="$onPrimary">
              {t(isPredict ? "module.predict.eyebrow" : "module.dex.eyebrow")}
            </Label>
            <SectionTitle color="$onPrimary">
              {t("module.preview.title")}
            </SectionTitle>
            <Body color="$onPrimary" opacity={0.78}>
              {t("module.preview.description")}
            </Body>
          </Card>
          <HairlineCard>
            <Label>{t("module.preview.status")}</Label>
            <SectionTitle>{t("module.preview.integrationTitle")}</SectionTitle>
            <Body>{t("module.preview.integrationDescription")}</Body>
          </HairlineCard>
          <Stack gap="$2">
            <Label>{t("module.preview.next")}</Label>
            <Body>
              {t(isPredict ? "module.predict.next" : "module.dex.next")}
            </Body>
          </Stack>
        </Content>
      </PageScroll>
    </Page>
  );
}
