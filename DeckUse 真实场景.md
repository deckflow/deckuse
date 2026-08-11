我重新按 DeckUse 当前 README 和 CLI 能力核过一遍。它现在真正可靠的 primitive 是：**本地拆解 PPTX、读取 slide/shape 结构、selector 精确定位、读/改文本、改字号、移动对象、全局/单页 replace、再 commit 回 PPTX**；README 也明确把 coding agent 作为使用入口。它不负责渲染。([GitHub](https://github.com/deckflow/deckuse "GitHub - deckflow/deckuse: 💻 A local-first structural editing engine for PPTX files. · GitHub"))

因此市场推广最好不要宣传“AI 自动设计 PPT”。**DeckUse 当前最有说服力的是：让 Agent 能操作已有 PPT，而不是只能生成 PPT。**

我会选下面这 **10 个真实、用户一眼能理解价值的场景**。

|#|市场场景|用户对 Agent 说什么|DeckUse 在背后做什么|价值|
|---|---|---|---|---|
|1|**批量更新 PPT**|“把这份 80 页 PPT 里的 2025 全部更新成 2026。”|全局搜索 + replace + commit|消灭机械修改|
|2|**公司/产品改名**|“把所有 Acme AI 改成 Acme Intelligence。”|跨 slide 定位文本并替换|Rebrand、产品更名|
|3|**从 PPT 提取结构化信息**|“把所有页面标题提取出来，告诉我这份 deck 在讲什么。”|list slides + get text|Agent 真正“读”PPT|
|4|**PPT 内容审查 Agent**|“检查有没有还写着 2025、旧产品名和旧版本号的页面。”|inspect + search/selectors|发布前 QA|
|5|**精准修改指定内容**|“第 7 页标题改成 Enterprise Strategy，其他东西不要动。”|selector → set text|不重新生成、不破坏原稿|
|6|**批量格式规范化**|“所有标题统一成 28pt。”|selector/filter → set font-size|品牌/模板规范|
|7|**版式位置批量修正**|“把所有页面标题向下移动一点。”|selector → move|自动化结构调整|
|8|**销售材料自动定制**|“把标准销售 Deck 改成给 Tesla 的版本，替换客户名和相关文案。”|定位特定对象 → 修改 → commit|Sales personalization|
|9|**基于模板自动生产变体**|“用这个 PPT 做美国版、日本版、Enterprise 版三个版本。”|同一 source workspace → 不同 mutation → 多个输出|一份母版，多版本维护|
|10|**PPT Coding Agent**|“检查这份 deck，找到需要修改的地方，完成修改并输出新 PPT。”|inspect → reason → selector → edit → commit|Cursor/Claude Code 直接操作 PPT|

其中 1–7 基本直接建立在 DeckUse 当前公开能力上；8–10 是 Agent 把这些 primitive 组合成 workflow，而不是声称 DeckUse 自己已经有这些完整产品功能。([GitHub](https://github.com/deckflow/deckuse "GitHub - deckflow/deckuse: 💻 A local-first structural editing engine for PPTX files. · GitHub"))

### 但如果是做市场推广，我会重新包装这 10 个场景

不要写成上面的“功能列表”。应该变成 **Before → Agent → After** 的 Demo。

例如最强的第一个 Demo：

> **Update a 100-slide deck in one prompt.**
> 
> “Change every reference from FY2025 to FY2026, but don't touch anything else.”
> 
> DeckUse lets your coding agent inspect the existing PowerPoint, locate the affected objects, edit them, and rebuild the `.pptx`.

第二个：

> **Let Claude Code edit your PowerPoint.**
> 
> “Go through this presentation. Find every slide still using our old product name and update it.”
> 
> No PowerPoint automation. No rebuilding the deck from scratch. The agent edits the existing PPTX.

第三个：

> **Turn PowerPoint into something agents can operate.**
> 
> “What's on slide 17?”
> 
> “Change its title.”
> 
> “Move the image.”
> 
> “Now update every textbox matching this rule.”
> 
> DeckUse gives agents selectors for PowerPoint objects—the conceptual analogy可以直接借鉴 DOM selector。README 本身已经支持 `slide:3/title`、`shape[type=textbox]`、嵌套 shape ID path 等寻址方式。([GitHub](https://github.com/deckflow/deckuse "GitHub - deckflow/deckuse: 💻 A local-first structural editing engine for PPTX files. · GitHub"))

---

## 我认为最值得打的 4 个 Hero Use Cases

如果网站首页只能展示四个，我不会平均分配，而是：

**① Coding agents can edit PowerPoint**

这是最大的 category story。

```text
Claude Code / Cursor
        ↓
    DeckUse
        ↓
existing.pptx
        ↓
inspect → locate → edit → commit
```

你不是在卖另一个 PPT AI，而是在告诉开发者：

> **Your coding agent can now operate PowerPoint files.**

README 当前其实已经在往这个方向表达——明确让用户把 DeckUse docs 给 Cursor、Claude Code 等 coding agent。([GitHub](https://github.com/deckflow/deckuse "GitHub - deckflow/deckuse: 💻 A local-first structural editing engine for PPTX files. · GitHub"))

**② Update hundreds of slides without rebuilding them**

这是最容易让普通用户理解 ROI 的。

典型任务：

“2025 → 2026”  
“OldBrand → NewBrand”  
“Product A → Product B”  
“旧 URL → 新 URL”  
“旧 disclaimer → 新 disclaimer”

优势不是 AI 文案，而是：

> **Preserve the existing deck. Change only what needs to change.**

**③ Build PowerPoint QA agents**

这可能是非常好的 B2B story：

> “Before sending a deck to a customer, have an agent inspect it.”

检查：

```text
old customer names
old dates
wrong product names
outdated URLs
missing required text
inconsistent terminology
unexpected text boxes
```

这里甚至**不需要 rendering**，所以非常符合 DeckUse 当前技术边界。

**④ Generate personalized decks from an approved master**

这可能是商业价值最高的：

```text
Approved Master Deck
        ↓
      Agent
   ↙     ↓      ↘
Tesla   Apple   Stripe
.pptx   .pptx   .pptx
```

销售团队不用让 AI 重新“设计 PPT”。

而是：

> **让 Agent 在经过设计和审批的 PPT 上，只修改允许修改的对象。**

这对于 Sales、Consulting、Marketing、Investor Relations 都非常实际。

---

## 有几个场景现在反而不应该宣传

基于当前公开能力，我会避免：

**“AI 自动美化 PPT”** —— 没有 rendering，Agent 无法可靠判断最终视觉效果。

**“AI 自动设计 slide”** —— DeckUse 现在更强的是 structural editing existing deck，不是 visual generation。

**“自动发现排版错误”** —— 没有视觉反馈时，“对象位置”不等于“知道视觉上好不好看”。

**“Excel 数据自动同步到 PPT”** —— 这是很好的未来场景，但从当前 README 暴露能力看，还不能把它作为 DeckUse 已具备能力宣传。

**“GitHub for PowerPoint”** —— 技术人会觉得有意思，但用户需求太抽象，适合作为底层 narrative，不适合作为第一层 use case。

---

## 最核心的市场定位，我会从之前的说法再收窄

DeckUse 当前真正有差异化的一句话不是：

> Git for PowerPoint

也不是：

> AI for PowerPoint

而是：

> **Give AI agents hands inside PowerPoint.**

或者更 developer-oriented：

> **The headless PowerPoint engine for AI agents.**

再技术一点：

> **Playwright for PowerPoint.**

因为浏览器 Agent 之所以强，不只是因为 AI “看得懂网页”，而是因为有 DOM + selector + actions。

DeckUse 当前正在给 PPT 建立类似的 abstraction：

```text
Browser                         PowerPoint

DOM                             OOXML structure
CSS selector                    DeckUse selector
querySelector                   get/list/show
element.textContent =           set text
element position                move
save state                      commit
       ↓                              ↓
Browser Agent                   PowerPoint Agent
```

**这个 narrative 能把你那 10 个应用场景全部串起来。**

[DeckUse GitHub](https://github.com/deckflow/deckuse?utm_source=chatgpt.com) · [DeckUse CLI 文档](https://deckflow.com/docs/en/cli/commands.html?utm_source=chatgpt.com)