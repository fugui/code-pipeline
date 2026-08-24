# CodePipeline 流水线组 设计·实现检视报告 🔍

> **版本**: v1.0
> **日期**: 2026-08-24
> **检视对象**: [pipeline_group_design.md](pipeline_group_design.md)（v2.0 精简版）与提交 `6e03d4f`（feat: 实现流水线组资源池管理与智能负载调度）
> **检视方式**: 文档审读、实现比对、`go build` / `go vet` / `go test ./...` / 前端 `tsc --noEmit`

---

## 1. 检视结论摘要

总体结论：**设计与实现高度一致，工程质量合格，构建与测试全部通过**。核心的数据模型、最小负载调度、组管理 API、启动迁移和前端交互均按设计落地。

但检视发现 **3 个高优先级问题** 和若干中低优先级问题，其中最关键的一点是：**设计建立在"三方平台存在硬性方案上限"的前提上，而实际业务没有强制上限、只需要组内均衡**。该前提的变化使"容量上限/满载状态/自愈"这整条机制失去必要性，建议在后续迭代中简化，而不是继续围绕它修补。

---

## 2. 关键前提澄清及其影响

本次检视确认了一个关键事实：**流水线没有强制方案数上限，只需要在同一组内做负载均衡**。该澄清直接回应了设计文档 §1.3 中列出的待确认问题，并改变了若干设计的优先级与合理性。

| 设计假设 | 实际情况 | 影响 |
| :--- | :--- | :--- |
| 单条流水线存在硬性方案上限 | 无强制上限 | `max_schemes_per_pipeline` 作为硬上限、`status='full'`、满载报错、删方案自愈等整条机制失去必要性 |
| 默认上限为 200 | 无上限概念 | 默认值 200 及"已用 245/600"类容量展示仅剩参考意义，不构成约束 |
| 方案数逼近上限是核心痛点 | 仅需组内均衡 | 核心价值收敛为"选组内最空闲节点"，其余容量管理是过度设计 |
| 并发创建可能超挂 | 无上限则无"超挂"问题 | 并发竞态影响降级为"临时负载不均"，低频场景下可接受 |
| 组内流水线阶段配置完全相同 | 未确认 | 同质性仍是"路由等价透明"的前提，建议确认或在 attach 时做约束 |

> 结论：在无硬上限前提下，**调度算法应简化为"实时选方案数最少的节点"**，容量校验、满载标记、状态自愈、容量报错均可移除；容量使用率可作为信息展示保留（软参考），不作为阻断条件。

---

## 3. 设计与实现一致性核对

| 设计点 | 实现情况 | 说明 |
| :--- | :--- | :--- |
| `PipelineGroup` 实体 + `Pipeline` 新增 `group_id` / `status` | ✅ 一致 | `ExecutionScheme` 零改动，组归属经 `pipeline_id → Pipeline.group_id` 推导 |
| 最小方案数优先调度（实时 COUNT，无冗余计数器） | ✅ 一致 | `../services/pipeline_group.go:22`，含 `ORDER BY scheme_count ASC` |
| 节点满载标 `full`，删方案后自愈 | ✅ 一致 | 与设计一致，但在"无硬上限"前提下属于可移除机制 |
| 创建方案兼容规则（group / pipeline / 兜底） | ✅ 一致 | `../handlers/pipeline.go:291` |
| 组管理 API（增删改查、attach/detach） | ✅ 一致 | `../handlers/pipeline_group.go:57` |
| 启动迁移：建默认组 + 归集现有流水线 | ⚠️ 有偏差 | 归集条件由设计的 `type = ?` 改成了 `type LIKE '%...%'`（见问题 6） |
| 前端：新建选组、编辑只读、组卡片、组列/状态列 | ✅ 一致 | 与设计 §7 相符 |
| 审计日志 | ✅ 一致 | 组与方案的增删改均落审计 |

---

## 4. 问题清单

### 4.1 设计层面（实现忠实继承，需设计层决策）

**D1. 容量上限机制基于错误前提，建议整体简化**

`max_schemes_per_pipeline`（默认 200）、`status='full'`、满载报错、删方案自愈（`HealPipelineStatus`）、前端"已满载"徽标——这一整条链路都服务于"硬上限"假设。实际无上限时：

- 调度只需 `SELECT ... WHERE group_id = ? ORDER BY scheme_count ASC LIMIT 1`，不需要容量判断与 `full` 标记；
- `Pipeline.status` 字段可移除（或保留作运维排空预留位，但现阶段无用）；
- "已用 x/总容量 y"展示可降级为纯信息（如负载率），不作为阻断提示。

**D2. 同质性只声明、不约束**

设计反复强调"组内流水线必须触发类型、阶段步骤完全一致"，但没有任何强制入口：`attach` 不校验 `pipeline.Type == group.Type`，创建方案也不校验方案触发方式与组类型是否匹配（`../handlers/pipeline_group.go:274`）。一旦误将异质流水线加入组，路由的"等价透明"前提即被破坏，而调度器不会察觉。建议：attach 时校验类型一致；组类型变更时提示组内节点类型不一致。

**D3. 迁移归集逻辑不幂等，"移出组"不持久**

设计 §8.3 要求"扫描所有 Pipeline 按 Type 归组"，实现为每次启动对 `group_id IS NULL` 的流水线重新归组（`../database/db.go:132`）。这与"detach 移出组"的语义直接冲突：管理员手动移出的流水线，下次重启会被静默拉回默认组。建议增加一次性迁移标记（例如仅在新默认组首次创建时执行归集），或记录"已归集"标识。

### 4.2 实现层面——高优先级

**P1-1. 前端"指定物理流水线"提示与后端优先级矛盾（静默失效）**

前端高级选项文案为"指定后将覆盖组调度"（`../frontend/src/components/ExecutionSchemeModal.tsx:846`），且打开高级面板选择具体流水线时不会清空 `group_id`；但后端逻辑为 `group_id` 优先，`pipeline_id` 被直接忽略（`../handlers/pipeline.go:291`）。管理员想精确指定节点时，请求同时携带 `group_id` 与 `pipeline_id`，后端却走组调度，结果与意图不符且无任何提示。

修复建议（二选一）：
1. 后端改为 `pipeline_id` 优先（对齐 UI 文案）；或
2. 前端将两者设为互斥：选择具体流水线时清空 `group_id`，选择组时清空 `pipeline_id`。

**P1-2. 未归组流水线被标 `full` 后无法自愈**

兼容模式下对独立流水线（`GroupID == nil`）做容量检查时同样会写 `status='full'`（`../handlers/pipeline.go:315`）；但 `HealPipelineStatus` 对 `GroupID == nil` 直接返回（`../services/pipeline_group.go:92`）。独立流水线一旦被标满，删方案后状态永久停留在"已满载"。

> 注：若按 D1 简化移除 `full` 机制，本问题随之消失；若在简化前需要兜底，可让自愈逻辑对独立流水线同样生效。

**P1-3. detach 不持久（同 D3）**

属设计+实现共同缺陷，实现侧修复方式：迁移归集加一次性标记；或 detach 时记录排除名单。

### 4.3 实现层面——中优先级

**P2-4. `UpdatePipeline` 的 `group_id` 是"缺失即清空"语义**

`pipeline.GroupID = req.GroupID`（`../handlers/pipeline.go:146`）直接赋值，而 `Status` 却用了"仅非空才更新"的保护。任何未携带 `group_id` 的 PUT 请求（旧客户端、脚本）都会把流水线静默移出组。建议与 `Status` 保持一致：`req.GroupID != nil` 才赋值；"移出组"统一走显式 detach 接口。

**P2-5. 兜底调度选的是"第一个活跃组"，而非"默认组"**

不带 `group_id`/`pipeline_id` 的请求按 `id ASC` 取第一个活跃组（`../handlers/pipeline.go:331`）。若管理员后续创建了 ID 更小的自定义组，旧请求会被路由到自定义组，且不校验组类型与方案触发方式是否匹配。建议按 `group_key`（`mr-gate-default` / `daily-build-default`）优先匹配，或按方案类型匹配。

**P2-6. 归集迁移使用 `LIKE '%MR%'` 模糊匹配**

`type LIKE '%' || type || '%'`（`../database/db.go:132`）会把类型中含 "MR" 的任意流水线（如未来的 `MR-Review`）误归入 MR 默认组。设计文档写的是 `type = ?` 精确匹配，实现偏离且更危险，建议改回精确匹配。

### 4.4 实现层面——低优先级

| 编号 | 问题 | 位置 |
| :--- | :--- | :--- |
| P3-1 | `SelectPipelineInGroup` 内写库（标记 full）错误被忽略，且选择函数内做写操作不纯粹 | `../services/pipeline_group.go:73` |
| P3-2 | `CreatePipeline` 接受任意 `status` 字符串，未限制为 `active`/`full` | `../handlers/pipeline.go:88` |
| P3-3 | `GET /pipeline-groups` 响应携带完整 `pipelines` 数组（含嵌套 Group），负载偏重 | `../handlers/pipeline_group.go:57` |
| P3-4 | 前端 `PipelineConfig` 保留旧 `availableGroups`/`selectedGroup` 死代码（恒为 `ALL`） | `../frontend/src/pages/PipelineConfig.tsx:227` |
| P3-5 | `App.tsx` 在 repos 视图每次 `searchQuery` 变化都重新请求 `/pipeline-groups` | `../frontend/src/App.tsx:147` |

### 4.5 并发说明

设计明确接受"依赖数据库隔离级别、不加分布式锁"。在无硬上限前提下，并发竞态不再造成容量违规，仅可能产生**短时负载不均**（两个请求同时选中同一节点）。对低频创建场景可接受；若后续需要更平滑的均衡，可在调度查询后对选中行加 `SELECT ... FOR UPDATE` 或将选择与写入放入同一事务，但现阶段不建议为此引入复杂度。

---

## 5. 测试情况

- 服务层单测覆盖：最小负载选择、满载标记、删除后自愈恢复（`../services/pipeline_group_test.go`），且顺带修复了测试外键约束与 `ResolveOperatorIdentifier(nil)` 的问题。
- `go build ./...`、`go vet ./...`、`go test ./...`、前端 `tsc --noEmit` 全部通过。
- **覆盖缺口**：handler 层无测试。以下行为均无测试保护：group/pipeline 优先级、兼容模式容量检查、兜底调度、attach/detach、迁移幂等性（重启不重复归组）、独立流水线自愈。

---

## 6. 修复建议与优先级

结合"无硬上限、仅组内均衡"的前提，建议按以下顺序推进：

1. **简化容量机制（对应 D1）**：移除容量上限校验、`full` 状态、`HealPipelineStatus` 与满载报错，调度收敛为纯最小负载选择；容量使用率仅作展示。此项同时消除 P1-2。
2. **修复 P1-1**：统一前端"指定物理流水线"与后端优先级语义（互斥或后端 `pipeline_id` 优先）。
3. **修复 P1-3 + P2-6（迁移相关）**：归集改为一次性执行 + `type = ?` 精确匹配。
4. **处理 P2-4、P2-5**：`UpdatePipeline` 的 `group_id` 缺省保留原值；兜底路由按默认组 `group_key` 匹配。
5. **补充 handler 层测试**：优先级、迁移幂等性、attach/detach 类型校验。
6. **顺手清理 P3 项**。

---

## 7. 附：检视范围

| 类型 | 内容 |
| :--- | :--- |
| 文档 | `docs/pipeline_group_design.md`（v2.0，2026-08-24） |
| 提交 | `6e03d4fc9511fd175a7d013043852c38dd00fcd6` |
| 后端 | `models/models.go`、`database/db.go`、`services/pipeline_group.go`、`handlers/pipeline_group.go`、`handlers/pipeline.go`、`main.go` |
| 前端 | `App.tsx`、`ExecutionSchemeModal.tsx`、`PipelineModal.tsx`、`PipelineConfig.tsx`、`types.ts` |
| 测试 | `services/pipeline_group_test.go`、`services/pipeline_client_test.go` |
