---
description: "Web GUI 的输入框历史：草稿为空时用 ↑/↓ 召回本会话已发送过的提示词；以 client 插件形式安装在输入框扩展座位上。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-composer-history

[English](README.md) | 中文

## Summary

召回当前会话已经发送过的提示词：草稿为空时按 ↑ 填入最近一条，继续按往前走；按 ↓ 往回走，走到最新一条后再按 ↓ 恢复召回前的草稿。功能以 client 插件形式发布，只使用 `ui-conversation` 暴露的输入框扩展座位——一个认领方向键的按键处理器和一个记录提交的提交监听器——输入框本身不保存任何历史语义。历史按会话独立存放在 `localStorage`，最多 50 条，刷新后仍在。

## Table of Contents

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型侧影响](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发者备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

把插件和 `ui-conversation` 一起挂到 Web 组合里（`dsh-web-app` 打包清单已经包含它）。插件自己注册到 `ctx.composerExtensions`，不需要任何配置。

| 输入框状态 | ↑ | ↓ |
| --- | --- | --- |
| 草稿为空 | 召回最新一条提示词 | 无动作 |
| 正在显示未经修改的召回内容 | 召回更早一条 | 前进一条 |
| 正在显示最新一条召回内容 | — | 恢复首次召回前的草稿 |
| 人手写的草稿（从未召回） | 正常移动光标 | 正常移动光标 |
| 召回后又改过文字 | 退出召回态，正常移动光标 | 退出召回态，正常移动光标 |
| 斜杠/提及菜单打开，或输入法组词中 | 菜单和输入法优先 | 菜单和输入法优先 |

每次输入框提交都会记录（包括指令）；连续重复会被合并，长按召回不会在同一条上打转。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节——点击展开</summary>

`apply(ctx)` 通过 `ctx.composerExtensions` 注册两个座位：认领 `up`/`down` 的按键处理器，以及一个提交监听器。输入框在菜单仲裁之后、原生光标处理之前把方向键交给插件处理器，并在每次提交时通知所有监听器；它不知道历史的存在。

按键处理器通过公开服务面拿到该会话的输入门面（`ctx.sessions.scope(id)` → `conversation.input.for(scope)`），向历史请求下一条草稿，再用 `setDraft` 应用。历史不接受这次手势时不写任何状态，普通光标移动照常发生。

每个会话一个 `PromptHistory`：最新一条在末尾，连续重复合并，裁剪到 50 条，存放在 `dsh.promptHistory.<sessionId>`。一旦草稿不再等于召回内容，召回游标就被放弃——这让“召回后再编辑”的草稿表现得像普通输入。

两个座位注册在同一个 `ctx.effect` 里，插件 fiber 销毁时同时注销处理器与监听器，并清空所有内存中的历史。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [ui-conversation](../ui-conversation/README.zh.md) — 拥有输入框、键位映射，以及本插件使用的扩展座位（见其中的输入框扩展一节）。
- [Client 包地图](../README.zh.md) — 相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型侧影响

没有，因为召回只修改本地草稿，在人提交之前不会创建、排队或发送任何消息。

#### KV Cache effect

无。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

这些限制描述当前的历史能力，属于当前包的约束，不是与 shell 历史的对比，也不是任务清单。

- **只记录本地提交** — 监听器只看到从这个浏览器页面发出的提示词。其他设备、CLI 或另一个浏览器窗口发送的提示词，只有在本页面提交之后才会进入历史；不会扫描会话日志。
- **没有搜索或模糊匹配** — 召回严格是历史里的上一条/下一条，没有反向搜索，也没有边走边过滤。
- **召回需要空草稿** — 人正在写的草稿永远不会被替换，也不支持在已有文本中做补全式召回。

<a id="dev-note"></a>
### 开发者备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
