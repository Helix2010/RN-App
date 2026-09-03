import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFoundationRuntime } from "../../app/runtime-context";
import type { RootStackParamList } from "../../navigation/types";
import { MarketScreen } from "../dex/ui/market-screen";
import { SwapScreen } from "../dex/ui/swap-screen";
import { MarketListScreen } from "../predict/ui/market-list-screen";
import { PositionsScreen } from "../predict/ui/positions-screen";

export type ModuleOverviewKind =
  "predict" | "positions" | "dex" | "market" | "swap";

/** 底栏业务页签 → 各领域一级页面的接线。 */
export function ModuleOverviewScreen({ kind }: { kind: ModuleOverviewKind }) {
  if (kind === "predict") return <PredictMarketsTab />;
  if (kind === "positions") return <PredictPositionsTab />;
  if (kind === "swap") return <SwapTab />;
  return <DexMarketTab />;
}

function PredictMarketsTab() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { config } = useFoundationRuntime();
  return (
    <MarketListScreen
      showPositionsEntry={config.modules.dex}
      onOpenEvent={(event, market) =>
        navigation.navigate("PredictEvent", {
          eventId: event.id,
          marketId: market?.id,
        })
      }
      onOrder={(market, outcome) =>
        navigation.navigate("PredictEvent", {
          eventId: market.eventId,
          marketId: market.id,
          outcome,
        })
      }
      onOpenTransfer={() => navigation.navigate("Transfer")}
      onOpenEnable={() => navigation.navigate("PredictEnable")}
      onOpenPositions={() => navigation.navigate("Positions")}
      onOpenLeaderboard={() => navigation.navigate("Leaderboard")}
    />
  );
}

function PredictPositionsTab() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <PositionsScreen
      onOpenEvent={(eventId, marketId) =>
        navigation.navigate("PredictEvent", { eventId, marketId })
      }
      onOpenSettlement={(marketId, eventId) =>
        navigation.navigate("PredictSettlement", { marketId, eventId })
      }
      onOpenTransfer={() => navigation.navigate("Transfer")}
    />
  );
}

function DexMarketTab() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <MarketScreen
      onOpenToken={(item) =>
        navigation.navigate("DexToken", {
          chain: item.token.chain,
          address: item.token.address,
        })
      }
      onOpenHistory={() => navigation.navigate("SwapHistory")}
    />
  );
}

function SwapTab() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <SwapScreen
      onOpenHistory={() => navigation.navigate("SwapHistory")}
      onOpenTransfer={() => navigation.navigate("Transfer")}
    />
  );
}
