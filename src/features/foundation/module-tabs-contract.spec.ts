import vectors from "../../../contracts/module-tabs.v1.json";
import { buildAppTabs } from "./app-tabs";
import { builtinMessages } from "../../core/config/builtin-messages";

/**
 * 四态底栏的契约向量，和 RN-Admin 共享同一份 JSON（`contracts/module-tabs.v1.json`
 * 与 `RN-Admin/src/modules/app-config/module-tabs.v1.json` 内容一致）。
 *
 * 两端不共享代码，只共享这组数据：管理端的底栏预览曾经在 `00` 下返回 DEX 那一套，
 * 而 App 实际是资产/记录/我的——管理员照着一个错的预览做决定，比崩溃更难发现。
 */
describe("module tab contract vectors", () => {
  const zh = builtinMessages("zh-CN");

  it.each(vectors.vectors)(
    "matches the shared vector for predict=$modules.predict dex=$modules.dex",
    ({ modules, tabs }) => {
      expect(buildAppTabs(modules).map((tab) => zh[tab.labelKey])).toEqual(
        tabs,
      );
    },
  );

  it("covers all four states", () => {
    expect(vectors.vectors).toHaveLength(4);
  });
});
