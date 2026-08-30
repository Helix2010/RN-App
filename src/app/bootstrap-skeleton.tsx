import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Card,
  Content,
  Page,
  Row,
  SkeletonBlock,
  Stack,
} from "../design-system";

export function BootstrapSkeleton() {
  const insets = useSafeAreaInsets();
  return (
    <Page accessibilityLabel="Loading application configuration">
      <Content paddingTop={insets.top + 24} flex={1}>
        <Row alignItems="center" gap="$3">
          <SkeletonBlock width={40} height={40} borderRadius={12} />
          <Stack flex={1} gap="$2">
            <SkeletonBlock width="38%" height={18} />
            <SkeletonBlock width="68%" height={12} />
          </Stack>
          <SkeletonBlock width={40} height={40} borderRadius={999} />
        </Row>
        <Card gap="$4" shadowOpacity={0}>
          <Row justifyContent="space-between">
            <SkeletonBlock width="32%" height={12} />
            <SkeletonBlock width={54} height={12} />
          </Row>
          <SkeletonBlock width="62%" height={34} />
          <SkeletonBlock width="78%" height={12} />
          <Row gap="$2">
            <SkeletonBlock flex={1} height={38} />
            <SkeletonBlock flex={1} height={38} />
            <SkeletonBlock flex={1} height={38} />
          </Row>
        </Card>
        <Row gap="$3">
          {[0, 1, 2, 3].map((item) => (
            <Stack key={item} flex={1} alignItems="center" gap="$2">
              <SkeletonBlock width={44} height={44} borderRadius={14} />
              <SkeletonBlock width="72%" height={10} />
            </Stack>
          ))}
        </Row>
        <SkeletonBlock width="28%" height={18} marginTop="$2" />
        <Card shadowOpacity={0} gap="$3">
          <Row justifyContent="space-between">
            <SkeletonBlock width="22%" height={12} />
            <SkeletonBlock width="18%" height={12} />
          </Row>
          <SkeletonBlock width="88%" height={18} />
          <Row gap="$2">
            <SkeletonBlock flex={1} height={44} />
            <SkeletonBlock flex={1} height={44} />
          </Row>
        </Card>
      </Content>
      <Row padding="$3" gap="$3" borderTopWidth={1} borderColor="$borderColor">
        {[0, 1, 2, 3].map((item) => (
          <Stack key={item} flex={1} alignItems="center" gap="$1">
            <SkeletonBlock width={24} height={24} borderRadius={8} />
            <SkeletonBlock width="52%" height={9} />
          </Stack>
        ))}
      </Row>
    </Page>
  );
}
