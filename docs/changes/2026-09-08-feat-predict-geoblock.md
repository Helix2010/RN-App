# 预测市场地区限制（geoblock）

日期：2026-09-08 · 设计：`docs/design/predict-geoblock-2026-09-08.md`

## 需求

沿用平台原有的地理检查服务（C 端 `GEO_CHECK_URL`），管理端只多一个服务地址；App 在预测模块内单独做展示与提示。

## 现有行为

App 从未做过地区限制。

## 预期行为

- RN-Server：`services.predict.endpoints.geo`（https 基址，校验同其它服务），不填 = 不做地区限制；随 bootstrap 下发。
- RN-Admin："预测市场"页服务地址列表多一行"地区限制检查地址"，说明不填即不限制；概览显示"未配置（不做地区限制）"。
- RN-App：进入预测模块后向 `{geo}/geoblock` 问一次（一次进程一次）。受限：列表红色横幅，详情 / 卡片 / 系列卡的买卖入口
  关闭并说明原因，启用引导不可继续，持仓"卖出"禁用；领取 / 划转不拦。检查失败：提示"无法确认所在地区" + 重试，
  交易入口同样关闭，不当作不受限。

## 开关

地理检查只由预测模块内页面发起（列表 / 详情 / 系列 / 启用 / 持仓），首页、资产页不发起；模块关着不请求。

## 与 C 端的差异

- 检查失败不放行（C 端失败当作不受限）。
- App 直连地理服务（C 端经 Next 代理且不转发用户 IP）。

## 风险

- 地理服务的正式地址、是否按来源 IP 判定、限流阈值需平台确认；未确认前不要在正式租户配置该地址。
- 配了地址但服务长期不可用时，用户会持续被挡在交易外（有重试）。

## 验证

- RN-Server：`TestParsePredictServiceEndpoints` 覆盖 geo 的归一化与 http 拒绝；全量 `go test ./...` 通过。
- RN-Admin：`predict-page.spec.tsx` 覆盖字段说明、填写后的提示与概览文案；typecheck / lint / format / vitest 通过。
- RN-App：`geo.spec.ts`（未配置不请求、请求形态与租户头、失败与契约错误抛出）、`http-predict-gateway.spec.ts`
  （`checkRegion` 两种配置）、`mock-predict-gateway.spec.ts`、`market-list-screen.spec.tsx`（受限横幅 + 全部买卖按钮禁用）、
  `event-detail-screen.spec.tsx`（受限说明 + Yes/No 禁用；检查失败 + 重试）；全量 jest / lint / typecheck / format 通过。
- 未做真机核对：线上租户没有配置地理服务地址，配置会影响真实用户；等平台给出地址后在 dev 租户联调。
