# Fix: launch-branding-duplicate

状态：Implemented（自动化验证完成；真机截图未运行）

## 根因

`e27d975` 曾规定启动背景图与独立 Logo/标题互斥；`77ed3bd` 为了支持叠加展示改成了同时渲染。对于已经把品牌 Logo 和产品名绘制进背景图的租户，这会产生重复品牌内容：背景图中的 Predict 标识加上 JS 重新绘制的 AnyFun/Logo。

## 修复

- 背景图成功加载或命中本地缓存时，隐藏独立 Logo 和标题，仅显示背景图。
- 背景图缺失或加载失败时，继续显示配置的独立 Logo 和标题。
- 背景图按原始颜色显示，不再叠加主题色半透明遮罩。
- 状态文案仍固定在底部，不受品牌图层切换影响。

## 验证

- `src/app/launch-screen.spec.tsx` 新增/更新背景图加载完成、本地缓存和失败路径断言。
- 启动页与运行时专项 Jest 通过（14 tests）。
- RN-App 格式、Lint、TypeScript、API、构建配置和 i18n 检查通过。
- iOS/Android Development Build、真机截图及生产租户 bootstrap 未运行。

## 回滚

恢复 `src/app/launch-screen.tsx` 与对应测试即可；无 API、数据库或原生 ABI 变化。
