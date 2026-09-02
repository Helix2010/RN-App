import type { ChainId } from "../core/gateways/types";
export type RootStackParamList = {
  AppShell: undefined;
  Profile: undefined;
  Settings: undefined;
  LanguageSettings: undefined;
  AppearanceSettings: undefined;
  PredictEvent: { eventId: string; marketId?: string; outcome?: "yes" | "no" };
  PredictSettlement: { marketId: string };
  PredictEnable: undefined;
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
  WalletBackup: { phrase?: string } | undefined;
  Transfer: { direction?: "deposit" | "withdraw"; amount?: string } | undefined;
  AccountDetail: { kind: "predict" | "wallet" };
  Send: { chain?: ChainId } | undefined;
  NotificationSettings: undefined;
  About: undefined;
  SecurityCenter: undefined;
};
