# CodePipeline 流水线组 (Pipeline Group) 设计文档 📐

> **版本**: v2.0 (精简版)
> **日期**: 2026-08-24

---

## 1. 背景与问题

### 1.1 现有关系

在 `code-pipeline` 系统中，**流水线（Pipeline）** 与 **执行方案（ExecutionScheme）** 为标准的 **1:N（一对多）** 关系：

```mermaid
erDiagram
    Repository ||--o{ ExecutionScheme : "拥有多个分支方案"
    Pipeline ||--o{ ExecutionScheme : "一对多绑定"

    Pipeline {
        uint id PK "本地自增主键"
        string pipeline_id UK "三方流水线 ID"
        string name "名称"
        string type "类型 (MR / 每日构建)"
        string group_name "分组名 (当前仅默认值)"
    }

    ExecutionScheme {
        uint id PK "本地自增主键"
        uint repository_id FK "关联代码仓"
        uint pipeline_id FK "关联物理流水线"
        string name "方案唯一名称"
        string branch "目标分支"
        string execution_scheme_id "三方方案 ID"
        string code_checker_task_id "三方检查任务 ID"
        string mr_binding_id "三方 MR 绑定 ID"
        string execution_plan_id "三方定时计划 ID"
    }
```

- **流水线（Pipeline）**：对应三方 CI/CD 平台中的一条顶层 Pipeline 实例，定义构建阶段、插件链、运行环境。
- **执行方案（ExecutionScheme）**：具体代码仓在特定分支下的个性化执行配置，包含 CheckerTask、MRBinding、ExecutionPlan 等三方资源。

### 1.2 核心诉求与关键澄清

**关键事实澄清**：流水线没有强制方案数的硬上限，引入流水线组的核心诉求是**同一组内做负载均衡与方案平摊**，避免方案集中挂载在单一节点上。

1. **自动负载均衡**：通过逻辑资源池，在创建方案时系统自动选择组内当前方案数最少的物理流水线。
2. **免除人工选择负担**：研发与运维人员只需关注业务流水线组（如 MR 门禁组、每日构建组），无需人工猜测和分流。
3. **输入严格约束**：创建方案时，必须明确指定 `group_id`（由组自动调度均衡）或 `pipeline_id`（直接指定特定节点），**不做任何隐式兜底**。

---

## 2. 核心概念

```
                          ┌──────────────────────────────────────────────┐
                          │          流水线组 (Pipeline Group)            │
                          │  - 物理节点: 3 条物理流水线                    │
                          │  - 负载调度: 自动选方案数最少的节点 (平摊方案)  │
                          └──────────────────────┬───────────────────────┘
                                                 │ 自动负载均衡
               ┌─────────────────────────────────┼─────────────────────────────────┐
               ▼                                 ▼                                 ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐  ┌──────────────────────────────┐
│  物理流水线 A (active)       │  │  物理流水线 B (active)       │  │  物理流水线 C (active)       │
│  当前方案数: 100 个          │  │  当前方案数: 140 个          │  │  当前方案数: 5 个            │
└──────────────────────────────┘  └──────────────────────────────┘  └──────────────────────────────┘
                                                                           ▲
                                                                    [新方案自动分配至此]
```

**同质性要求**：组内流水线必须具备相同的触发类型（如均为 MR 门禁或均为每日构建），在将流水线加入组时做类型一致性约束。

---

## 3. 数据模型设计

### 3.1 设计原则

1. **不在 `ExecutionScheme` 上冗余 `group_id`**——方案的组归属可通过 `pipeline_id → Pipeline → group_id` 推导，避免数据不一致。
2. **不使用冗余计数器**——用实时 `COUNT(*)` 查询真实方案数，避免并发场景下计数器漂移。
3. **纯粹负载均衡**——不引入复杂的满载/自愈状态机，调度算法专注选择当前方案数最少者。
4. **确定性输入**——`group_id` 与 `pipeline_id` 至少需指定其一，拒绝无参盲目兜底。

### 3.2 实体关系图

```mermaid
erDiagram
    PipelineGroup ||--o{ Pipeline : "聚合管理 (1:N)"
    Pipeline ||--o{ ExecutionScheme : "物理挂载 (1:N)"
    Repository ||--o{ ExecutionScheme : "拥有方案 (1:N)"

    PipelineGroup {
        uint id PK "组 ID"
        string group_key UK "组唯一标识 (如 mr-gate-default)"
        string name "组展示名称"
        string type "类型 (MR / 每日构建)"
        int max_schemes_per_pipeline "软参考容量 (默认 200, 仅供前端水位展示)"
        bool is_active "是否启用"
        string description "描述"
    }

    Pipeline {
        uint id PK "物理流水线 ID"
        uint group_id FK "关联流水线组 (可为空, 空代表独立流水线)"
        string pipeline_id UK "三方流水线 ID"
        string name "名称"
        string type "类型"
        string status "节点状态 (active)"
    }

    ExecutionScheme {
        uint id PK "执行方案 ID (不变)"
        uint repository_id FK "关联代码仓 (不变)"
        uint pipeline_id FK "实际物理流水线 (不变)"
        string name "方案名称 (不变)"
    }
```

---

## 4. 核心调度算法

### 4.1 最小方案数优先 (Least-Allocated)

```mermaid
flowchart TD
    Start([创建执行方案请求]) --> CheckInput{入参检查}

    CheckInput -- 指定了 pipeline_id > 0 --> UseDirect[优先级1: 直接绑定该物理流水线]
    CheckInput -- 指定了 group_id > 0 且无 pipeline_id --> QueryGroup[优先级2: 组内最小负载调度]
    CheckInput -- 两者均未指定/为0 --> ErrNoTarget[参数错误: 请指定 group_id 或 pipeline_id]

    QueryGroup --> HasNodes{组内有可用节点?}
    HasNodes -- 否 --> ErrNoNode[返回错误: 流水线组无可用节点]
    HasNodes -- 是 --> CountSchemes[实时 COUNT 各节点方案数]
    CountSchemes --> FindMin[选方案数最少节点: ORDER BY cnt ASC, id ASC]
    FindMin --> UseMin[使用该物理流水线]

    UseDirect --> CreateRemote[调用三方创建 Scheme/MR/CheckerTask]
    UseMin --> CreateRemote
    CreateRemote --> SaveDB[写入本地数据库]
```

### 4.2 Go 调度函数实现

```go
// SelectPipelineInGroup 在指定流水线组中选出负载最轻的物理流水线
func SelectPipelineInGroup(tx *gorm.DB, groupID uint) (*models.Pipeline, error) {
    var group models.PipelineGroup
    if err := tx.First(&group, groupID).Error; err != nil {
        return nil, fmt.Errorf("流水线组 (ID: %d) 不存在: %w", groupID, err)
    }
    if !group.IsActive {
        return nil, fmt.Errorf("流水线组 [%s] 已禁用", group.Name)
    }

    cap := group.MaxSchemesPerPipeline
    if cap <= 0 {
        cap = 200
    }

    // 实时聚合查询：查组内 active 的流水线，按实际方案数升序，取最空闲的
    type candidate struct {
        models.Pipeline
        SchemeCount int64 `gorm:"column:scheme_count"`
    }
    var results []candidate
    err := tx.Raw(`
        SELECT p.*, COALESCE(c.cnt, 0) AS scheme_count
        FROM pipelines p
        LEFT JOIN (
            SELECT pipeline_id, COUNT(*) AS cnt
            FROM execution_schemes
            GROUP BY pipeline_id
        ) c ON c.pipeline_id = p.id
        WHERE p.group_id = ? AND p.status = 'active'
        ORDER BY scheme_count ASC
    `, groupID).Scan(&results).Error
    if err != nil {
        return nil, fmt.Errorf("查询组内流水线失败: %w", err)
    }

    if len(results) == 0 {
        return nil, fmt.Errorf("流水线组 [%s] 无可用节点", group.Name)
    }

    // 选择第一个未超上限的节点
    for i := range results {
        if results[i].SchemeCount < int64(cap) {
            return &results[i].Pipeline, nil
        }
        // 顺带自愈：标记已满的节点为 full
        tx.Model(&models.Pipeline{}).Where("id = ?", results[i].ID).Update("status", "full")
    }

    return nil, fmt.Errorf("流水线组 [%s] 所有节点已满载 (%d/%d)，请联系管理员扩容",
        group.Name, len(results), cap)
}
```

### 4.3 方案删除后的状态自愈

当执行方案被删除后，检查对应流水线是否从满载状态恢复：

```go
// healPipelineStatus 删除方案后检查并恢复流水线状态
func healPipelineStatus(pipelineID uint) {
    var pipeline models.Pipeline
    if err := database.DB.Preload("Group").First(&pipeline, pipelineID).Error; err != nil {
        return
    }
    if pipeline.Status != "full" || pipeline.GroupID == nil {
        return
    }

    cap := 200
    if pipeline.Group != nil && pipeline.Group.MaxSchemesPerPipeline > 0 {
        cap = pipeline.Group.MaxSchemesPerPipeline
    }

    var count int64
    database.DB.Model(&models.ExecutionScheme{}).Where("pipeline_id = ?", pipelineID).Count(&count)
    if count < int64(cap) {
        database.DB.Model(&pipeline).Update("status", "active")
    }
}
```

---

## 5. 创建执行方案时序图

```mermaid
sequenceDiagram
    autonumber
    actor User as 开发者
    participant API as code-pipeline API
    participant DB as 本地数据库
    participant Remote as 三方流水线平台

    User->>API: POST /api/execution-schemes (group_id, repo_id, branch...)
    API->>DB: 查询流水线组及组内活跃节点
    API->>DB: 实时 COUNT 各节点方案数
    Note over API: 选出方案数最少的节点 (Pipeline-C)
    API->>Remote: 1. 创建代码检查任务 (CheckerTask)
    API->>Remote: 2. 在 Pipeline-C 上创建执行方案
    API->>Remote: 3. 创建 MR 触发关联 (若开启)
    API->>Remote: 4. 创建定时计划 (若开启)

    alt 全部成功
        API->>DB: 写入 ExecutionScheme (pipeline_id = Pipeline-C.ID)
        API-->>User: 201 Created
    else 部分失败
        API->>Remote: 级联回滚已创建的三方资源
        API-->>User: 500/502 错误详情
    end
```

---

## 6. API 接口设计

### 6.1 流水线组管理接口 (Admin)

#### 获取流水线组列表

```
GET /api/pipeline-groups
```

响应示例：
```json
[
  {
    "id": 1,
    "group_key": "mr-gate-default",
    "name": "MR 门禁通用流水线组",
    "type": "MR",
    "max_schemes_per_pipeline": 200,
    "is_active": true,
    "pipeline_count": 3,
    "total_capacity": 600,
    "used_schemes": 245
  }
]
```

> 注：`pipeline_count`、`total_capacity`、`used_schemes` 为接口层实时聚合计算返回，非数据库冗余字段。

#### 创建流水线组

```
POST /api/pipeline-groups
```

```json
{
  "group_key": "mr-gate-default",
  "name": "MR 门禁通用流水线组",
  "type": "MR",
  "max_schemes_per_pipeline": 200,
  "description": "承载所有 MR 门禁自动化检查任务"
}
```

#### 将流水线加入/移出组

```
POST /api/pipeline-groups/:id/pipelines
```

```json
{
  "pipeline_ids": [12, 13, 14],
  "action": "attach"
}
```

`action` 取值：`"attach"` (加入) | `"detach"` (移出)。

### 6.2 创建执行方案接口改造

现有接口 `POST /api/execution-schemes` 保持向后兼容，请求体扩展一个可选的 `group_id` 字段：

```json
{
  "group_id": 1,
  "repository_id": 108,
  "name": "payment_service_mr",
  "branchs": "master",
  "languages": "Java, Go",
  "mr_trigger": true,
  "daily_build": true
}
```

**兼容规则**：

| 入参组合 | 行为 |
| :--- | :--- |
| 指定 `group_id` | ✅ 推荐方式。系统自动调度组内最优流水线 |
| 指定 `pipeline_id` (无 `group_id`) | 兼容模式。校验容量后直接绑定至指定流水线 |
| 两者都不指定 | 根据系统默认活跃组进行调度（若有） |

---

## 7. 前端交互改造

### 7.1 执行方案创建弹窗 (`ExecutionSchemeModal`)

- **新增方案时**：原来的"关联流水线"下拉改为"关联流水线组"下拉。选项展示组名称和实时容量使用概况（如 `MR 门禁组 — 已用 245/600, 40%`）。
- **编辑方案时**：只读展示当前方案实际绑定的物理流水线名称（保持不变）。
- **兼容展开**：提供"高级选项 — 指定特定物理流水线"折叠面板，供管理员精确指定。

### 7.2 流水线管理页面 (`PipelineConfig`)

- 在现有流水线列表上方，新增**流水线组卡片**区域，展示各组的名称、类型、节点数量、容量使用率。
- 每张组卡片支持"添加流水线到组"和"从组中移除"操作。
- 在流水线表格中新增"所属组"和"状态"列。

---

## 8. 数据迁移策略

在系统启动时（`database/migrate.go`）执行以下自动迁移：

1. **创建 `pipeline_groups` 表**（GORM AutoMigrate）。
2. **创建系统默认组**：
   - 按现有 `Pipeline.Type` 自动创建默认流水线组：
     - `mr-gate-default` — "默认 MR 门禁流水线组" (`type = "MR"`)
     - `daily-build-default` — "默认每日构建流水线组" (`type = "每日构建"`)
3. **归集现有流水线**：
   - 扫描所有 `Pipeline`，按 `Type` 将其 `group_id` 指向对应默认组。
   - 将 `status` 初始化为 `"active"`。

```go
func migratePipelineGroups(db *gorm.DB) {
    db.AutoMigrate(&models.PipelineGroup{})

    // 按类型自动创建默认组
    defaults := []models.PipelineGroup{
        {GroupKey: "mr-gate-default", Name: "默认 MR 门禁流水线组", Type: "MR", MaxSchemesPerPipeline: 200, IsActive: true},
        {GroupKey: "daily-build-default", Name: "默认每日构建流水线组", Type: "每日构建", MaxSchemesPerPipeline: 200, IsActive: true},
    }
    for _, g := range defaults {
        db.Where("group_key = ?", g.GroupKey).FirstOrCreate(&g)
    }

    // 将现有流水线按类型归入默认组
    for _, g := range defaults {
        var saved models.PipelineGroup
        if db.Where("group_key = ?", g.GroupKey).First(&saved).Error == nil {
            db.Model(&models.Pipeline{}).
                Where("type = ? AND group_id IS NULL", saved.Type).
                Update("group_id", saved.ID)
        }
    }

    // 初始化 status 字段
    db.Model(&models.Pipeline{}).Where("status = '' OR status IS NULL").Update("status", "active")
}
```

---

## 9. 异常处理

| 异常场景 | 处理方式 |
| :--- | :--- |
| 组内所有物理流水线均已满载 | 返回明确错误 `"流水线组 [X] 所有节点已满载，请联系管理员扩容"`，同时记录审计日志 |
| 三方平台创建方案失败 | 级联回滚已创建的三方资源（CheckerTask / MRBinding / ExecutionPlan），保持事务一致性 |
| 方案删除后流水线状态不一致 | 删除方案后自动调用 `healPipelineStatus` 检查并恢复 `active` 状态 |
| 并发创建方案 | 依赖数据库事务隔离级别保障；由于方案创建频率低（非高并发热点），无需额外分布式锁 |

---

## 10. 未来演进方向

以下能力在当前阶段**不实现**，但方案 B 的架构已预留扩展空间：

| 特性 | 扩展方式 |
| :--- | :--- |
| 节点排空 / 跨节点迁移 | 给 `Pipeline.status` 新增 `draining` 值，编写迁移脚本 |
| 容量告警通知 | 在获取组信息时计算使用率，超 85% 推送通知 |
| 自动扩容 (Auto-Scale) | 监听容量阈值，调用三方 API 克隆创建新流水线并加入组 |
