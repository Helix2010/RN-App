export type RootStackParamList = {
  AppShell: undefined;
  Profile: undefined;
  Settings: undefined;
  LanguageSettings: undefined;
  AppearanceSettings: undefined;
  PredictEvent: { eventId: string; marketId?: string; outcome?: "yes" | "no" };
  PredictSettlement: { marketId: string };
  Leaderboard: undefined;
  Positions: undefined;
  DexToken: { chain: "bsc" | "eth" | "base"; address: string };
  Swap:
    | {
        chain?: "bsc" | "eth" | "base";
        sellAddress?: string;
        buyAddress?: string;
      }
    | undefined;
  SwapHistory: undefined;
  Approvals: undefined;
  Wallets: undefined;
  WalletBackup: undefined;
  Transfer: { direction?: "deposit" | "withdraw"; amount?: string } | undefined;
  AccountDetail: { kind: "predict" | "wallet" };
  Send: { chain?: "bsc" | "eth" | "base" } | undefined;
  NotificationSettings: undefined;
  About: undefined;
  SecurityCenter: undefined;
};
