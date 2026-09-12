import type { ChainId } from "../core/gateways/types";
export type RootStackParamList = {
  AppShell: undefined;
  Profile: undefined;
  Settings: undefined;
  LanguageSettings: undefined;
  AppearanceSettings: undefined;
  PredictEvent: { eventId: string; marketId?: string; outcome?: "yes" | "no" };
  PredictSettlement: { marketId: string; eventId: string };
  PredictEnable: undefined;
  /** periodMarketId：从持仓进来时定位到那一期（该期市场的 conditionId） */
  PredictSeries: { slug: string; id?: string; periodMarketId?: string };
  Leaderboard: undefined;
  Positions: undefined;
  DexToken: { chain: ChainId; address: string };
  Swap:
    | {
        chain?: ChainId;
        sellAddress?: string;
        buyAddress?: string;
      }
    | undefined;
  SwapHistory: undefined;
  Approvals: undefined;
  Wallets: undefined;
  WalletSetup: undefined;
  WalletImport: undefined;
  // 助记词不进导航参数：导航状态会被持久化 / 上报读到（安全评审 N36），
  // 新建钱包用 features/wallet/model/pending-reveal 的一次性通道交接
  WalletBackup: undefined;
  /** 开通流程的最后一步：给金库加口令（安全评审 N6）。可跳过。 */
  WalletPassphrase: undefined;
  Transfer: { direction?: "deposit" | "withdraw"; amount?: string } | undefined;
  AccountDetail: { kind: "predict" | "wallet" };
  Records: { tab?: "predict" | "wallet" } | undefined;
  Send: { chain?: ChainId } | undefined;
  NotificationSettings: undefined;
  About: undefined;
  SecurityCenter: undefined;
};
