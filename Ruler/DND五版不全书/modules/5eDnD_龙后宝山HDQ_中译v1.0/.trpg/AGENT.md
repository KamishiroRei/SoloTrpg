# 5eDnD_龙后宝山HDQ_中译v1.0 模组工作规范

本目录中的原始资料是事实来源。AI 开始带团或继续开发前，应先读取 .trpg/module-manifest.json、.trpg/index.json 与 .trpg/public-index.json。

## 模组概要

- 战役：龙后的宝山 Hoard of the Dragon Queen（《巨龙僭政》第一部分）
- 等级跨度：1→8 级（里程碑式：第1章末2级、第2章末3级、第3章末4级、第4章末5级、第5/6章末6级、第7章末7级、第8章末8级）
- 主线：龙巫教劫掠财宝→运往北方→涅瑞塔堡→狩猎旅舍→通天堡，最终目标为在龙之井召唤提亚马特。
- 8 章 + 附录A（背景项）/ B（怪物）/ C（魔法物品），PDF 共 89 页。

## 资料使用规则

- 所有规则裁定链接到 `Ruler/DND五版不全书/source/` 或 `compressed/` 的精确来源；不得把整份规则源码复制到模组整理文件。
- 场景、NPC、地点、遭遇、物品、线索、分支与插图使用稳定 ID（见 index.json：sc-*/npc-*/loc-*/enc-*/itm-*/clue-*/br-*/sec-*/media-*）。
- 原始 PDF 只读保存，不回写、不移动。
- 带团期间发生的状态变化写入玩家存档与会话，不回写原始模组。

## GM 秘密与公开流程

- 默认全部内容 GM 私有（index.json `audience: gm`，`secret: true` 字段标记秘密）。
- 只有写进 `public-index.json` 的 `released` 列表的条目才向玩家或 AIPL 可见；每条记录路径、标题、公开原因与进度条件。
- 带团中新公布内容时更新 public-index.json 并记录时间。

## 关键剧透提示（勿对玩家提前公开）

- 烁银是第4章『最卑劣的谋杀』真凶（npc-jamna、sec-murderer）。
- 瑞兹米尔宝箱与其魔法同调，死后内容物传送龙之井（sec-rezmir-box）。
- 涅瑞塔堡地底传送门口令『德雷齐尔』（clue-portal-word）。
- 双生黑龙秘密（sec-twin-dragons）。
- 布拉戈提库斯死后精魄夺堡坠毁（sec-esclarotta）。

## 文件结构

```
5eDnD_龙后宝山HDQ_中译v1.0/
  .trpg/
    module-manifest.json   模组身份/章节页/状态
    index.json             GM 私有完整索引（场景/NPC/地点/遭遇/物品/线索/分支/秘密/媒体/规则链接）
    public-index.json      玩家公开索引（初始为空）
    AGENT.md                本规范
    import.log              导入与验证记录
  *.pdf                     原始资料（只读）
```
