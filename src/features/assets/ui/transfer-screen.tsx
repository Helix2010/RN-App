import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  Content,
  Page,
  PageScroll,
  PageState,
  PrimaryButton,
  ScreenHeader,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import { requestAuth } from "../../session/model/auth-sheet-store";
import { TransferForm, type TransferDirection } from "./transfer-form";

/** 全屏承载的划转（供“余额不足”按钮与深链跳转、预填数量）。 */
export function TransferScreen({
  direction,
  amount,
  onBack,
  onOpenEnable,
  onOpenRecords,
}: {
  direction?: TransferDirection;
  amount?: string;
  onBack: () => void;
  onOpenEnable: () => void;
  onOpenRecords: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  const session = useSession();
  const address = session.data?.address;
  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("transfer.title")}
          onBack={onBack}
          backLabel={t("action.back")}
        />
      </Content>
      {address ? (
        <PageScroll>
          <Content paddingTop="$2">
            <TransferForm
              address={address}
              initialDirection={direction}
              initialAmount={amount}
              onFinished={onBack}
              onOpenEnable={onOpenEnable}
              onOpenRecords={onOpenRecords}
            />
          </Content>
        </PageScroll>
      ) : (
        <PageState
          title={t("assets.signInToView")}
          action={
            <PrimaryButton
              onPress={() => requestAuth({ type: "open_transfer" })}
            >
              {t("home.connectWallet")}
            </PrimaryButton>
          }
        />
      )}
    </Page>
  );
}
