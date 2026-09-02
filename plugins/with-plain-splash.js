const {
  AndroidConfig,
  withAndroidColors,
  withAndroidStyles,
} = require("expo/config-plugins");

/**
 * 把 Android 原生启动图改成纯色。
 *
 * 没有接 expo-splash-screen 时，`expo prebuild` 生成的 `Theme.App.SplashScreen`
 * 用模板自带的 `@drawable/splashscreen_logo`（网格 + 同心圆的占位图）当窗口背景。
 * 用户冷启动先看到这张占位图，再看到 JS 启动页里的租户 logo——两张不同的启动图。
 * 租户 logo 由 JS 启动页按服务端下发的品牌配置画一次，原生层只负责在 JS 起来前
 * 铺一层与图标同色的背景。
 */
module.exports = function withPlainSplash(config, { backgroundColor }) {
  if (
    typeof backgroundColor !== "string" ||
    !/^#[0-9a-fA-F]{6}$/.test(backgroundColor)
  ) {
    throw new Error(
      `with-plain-splash: backgroundColor must be #RRGGBB, got ${String(backgroundColor)}`,
    );
  }
  config = withAndroidColors(config, (mod) => {
    mod.modResults = AndroidConfig.Colors.assignColorValue(mod.modResults, {
      name: "splashscreen_background",
      value: backgroundColor,
    });
    return mod;
  });
  config = withAndroidStyles(config, (mod) => {
    mod.modResults = AndroidConfig.Styles.assignStylesValue(mod.modResults, {
      // add 不传时这个助手是"移除"语义
      add: true,
      parent: { name: "Theme.App.SplashScreen", parent: "AppTheme" },
      name: "android:windowBackground",
      value: "@color/splashscreen_background",
    });
    return mod;
  });
  return config;
};
