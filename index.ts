// crypto.getRandomValues 的 CSPRNG polyfill：Hermes 不自带，而 ethers 的密钥生成、
// salt 与 nonce 全靠它。必须排在所有其他 import 之前，且不能只在钱包模块里 import
// —— 那样 Metro 的模块顺序无法保证。
import "react-native-get-random-values";
// WalletConnect 在 RN 上依赖 URL / TextEncoder / crypto 的 polyfill，
// 必须在 SDK 之前加载，所以放在入口而不是钱包模块里。
import "react-native-url-polyfill/auto";
import "fast-text-encoding";
import "@walletconnect/react-native-compat";
import "react-native-gesture-handler";

import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
