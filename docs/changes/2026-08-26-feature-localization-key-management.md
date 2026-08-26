# Feature: localization-key-management

## 用户场景

- 管理员通过侧边弹层创建自定义多语言 Key，添加后只进入当前草稿。
- 管理员可按 Key 或任意语言 Value 模糊搜索，可移除未保存的新 Key，可停用或启用已有文案。
- App、管理端、服务端和发布资源统一使用小写 Key，避免大小写不一致或重复。

## 验收条件

1. 新增 Key 自动转为小写，只允许字母、数字、点、下划线和短横线，并由前后端双重校验唯一性。
2. 新增、移除和启停在点击保存前不调用服务端；保存时只提交变化项。
3. `language_document.deleted=1` 的租户 Key 视为停用：该 Key 的所有语言不进入租户发布 JSON；重新启用后恢复全量发布。
4. App 对本地和远程消息包使用同一个小写规范，并对调用方传入 Key 做小写查找。
5. 搜索只过滤展示，不改变草稿和提交内容。

## 页面状态与异常

- loading/error/content 沿用多语言管理页现有状态。
- 侧边弹层显示空表单、格式错误、重复 Key、缺少回退语言文案。
- 未保存新增项可直接移除；已有项仅允许启停，避免误做物理删除。
- 服务端并发创建重复 Key 返回 `409 LANGUAGE_DOCUMENT_KEY_EXISTS`。

## 接口与数据影响

- `GET /v1/admin/localization` 的文案项增加 `enabled`。
- `PUT /v1/admin/localization/documents` 的增量项增加可选 `create` 与 `enabled`。
- 数据迁移将历史 Key 统一为小写，并保留 `deleted` 作为该租户 Key 的启停状态（同一 Key 的各语言行保持一致）。

## 发布、风险与回滚

- RN-App 仅改变 TypeScript 运行时查找和缓存 Key，不涉及原生 ABI，可通过 OTA 交付。
- 管理端与服务端需同时部署；服务端先部署兼容旧管理端。
- 数据库 Key 小写迁移不可直接反向恢复大小写；回滚代码时仍可继续使用小写 Key。
