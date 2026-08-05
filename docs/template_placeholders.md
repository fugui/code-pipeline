# CodePipeline 系统模板占位符 (Template Placeholders) 配置指南 📖

在 `code-pipeline` 系统中，涉及与远程 Git 托管平台（如 CodeHub/GitLab）及底层流水线引擎交互的许多 HTTP 接口，其请求体（Request Body）与请求 URL 均支持基于模板占位符的动态替换。

本文档汇总并详细说明系统当前支持的所有模板占位符及其使用规范。

---

## 目录
1. [远程 Git 平台 (CodeHub) 占位符](#1-远程-git-平台-codehub-占位符)
   - [创建代码仓 (Create Repo)](#11-创建代码仓-create_repo_body)
   - [创建分支 (Create Branch)](#12-创建分支-create_branch_body)
   - [分支保护配置 (Configure Protection)](#13-分支保护配置-configure_protection_body)
   - [成员权限控制 (Configure ACL)](#14-成员权限控制-configure_acl_body)
   - [URL 动态拼接参数](#15-url-动态拼接参数)
2. [流水线系统 (Pipeline System) 占位符](#2-流水线系统-pipeline-system-占位符)
   - [创建执行方案 (Create Execution Scheme)](#21-创建执行方案-create_execution_scheme_body)
   - [合并请求绑定 (Create MR Binding)](#22-合并请求绑定-create_mr_binding_body)
   - [创建代码检查任务 (Create Checker Task)](#23-创建代码检查任务-create_checker_task_body)
   - [创建每日/定时构建 (Create Execution Plan)](#24-创建每日定时构建-create_execution_plan_body)
   - [Webhook 注册 (Create Webhook)](#25-webhook-注册-create_webhook_body)
3. [模板使用最佳实践与示例](#3-模板使用最佳实践与示例)

---

## 1. 远程 Git 平台 (CodeHub) 占位符

### 1.1 创建代码仓 (`create_repo_body`)
对应配置项：`codehub.create_repo_body`

| 占位符 | 数据类型 | 说明 / 填充格式 | 示例值 |
| :--- | :--- | :--- | :--- |
| `{REPO_NAME}` | String | 用户申领或创建的代码仓名称 | `"my-backend-service"` |
| `{GROUP_PATH}` | String | 代码仓所属托管组的完整路径 | `"tech/infra"` |
| `{GROUP_ID}` | Number/String | 代码仓所属托管组在平台的唯一数字 ID | `100` |
| `{TAG_LIST}` | String Array | 格式化后的标签切片项。系统会自动去重并追加系统标识 `"CodeShield"`。在 JSON 中直接写在 `[{TAG_LIST}]` 内 | `"tag1","tag2","CodeShield"` |
| `{DESCRIPTION}` | String | 申请单或创建请求填写的仓库详细描述说明 | `"核心鉴权与流水线服务"` |

**示例模板：**
```yaml
codehub:
  create_repo_body: |
    {
      "name": "{REPO_NAME}",
      "namespace_path": "{GROUP_PATH}",
      "namespace_id": "{GROUP_ID}",
      "tag_list": [{TAG_LIST}],
      "description": "{DESCRIPTION}",
      "visibility": "private"
    }
```
*替换后的实际 HTTP Request Body 例示：*
```json
{
  "name": "my-backend-service",
  "namespace_path": "tech/infra",
  "namespace_id": "100",
  "tag_list": ["microservice", "go", "CodeShield"],
  "description": "核心鉴权与流水线服务",
  "visibility": "private"
}
```

---

### 1.2 创建分支 (`create_branch_body`)
对应配置项：`codehub.create_branch_body`

| 占位符 | 数据类型 | 说明 | 示例值 |
| :--- | :--- | :--- | :--- |
| `{BRANCH_NAME}` | String | 准备新创建的目标分支名称 | `"feature/v1.0-auth"` |
| `{SOURCE_REF}` | String | 衍生出新分支的基线分支名或 Commit Hash | `"master"` |

**示例模板：**
```json
{
  "branch_name": "{BRANCH_NAME}",
  "ref": "{SOURCE_REF}"
}
```

---

### 1.3 分支保护配置 (`configure_protection_body`)
对应配置项：`codehub.configure_protection_body`

| 占位符 | 数据类型 | 说明 | 示例值 |
| :--- | :--- | :--- | :--- |
| `{BRANCH_PATTERN}` | String | 受保护分支的匹配规则/分支名称 | `"master"` 或 `"feature-*"` |

**示例模板：**
```json
{
  "name": "{BRANCH_PATTERN}",
  "push_access_level": 0,
  "merge_access_level": 30
}
```

---

### 1.4 成员权限控制 (`configure_acl_body`)
对应配置项：`codehub.configure_acl_body`

| 占位符 | 数据类型 | 说明 | 示例值 |
| :--- | :--- | :--- | :--- |
| `{PRINCIPAL_TYPE}` | String | 权限主体类型 | `"user"` / `"group"` |
| `{PRINCIPAL_ID}` | String/Number | 成员或用户组的唯一标识 ID | `"1001"` |
| `{ACCESS_LEVEL}` | Number | 平台的权限级别数字 | `30` (Developer), `40` (Maintainer) |

**示例模板：**
```json
{
  "principal_type": "{PRINCIPAL_TYPE}",
  "principal_id": "{PRINCIPAL_ID}",
  "access_level": {ACCESS_LEVEL}
}
```

---

### 1.5 URL 动态拼接参数
针对以 `_url` 结尾的配置（如 `codehub.get_mrs_url`，`pipeline_system.get_webhooks_url` 等）：

| 占位符 | 说明 | 适用配置项举例 |
| :--- | :--- | :--- |
| `{REPO_ID}` | 代码仓远程项目 ID | `http://.../projects/{REPO_ID}/merge_requests` |
| `{PROJECT_ID}` | 兼容使用的仓库项目 ID 别名 | `http://.../projects/{PROJECT_ID}/settings` |

---

## 2. 流水线系统 (Pipeline System) 占位符

### 2.1 创建执行方案 (`create_execution_scheme_body`)
对应配置项：`pipeline_system.create_execution_scheme_body`

| 占位符 | 说明 |
| :--- | :--- |
| `{SCHEME_NAME}` / `{NAME}` | 执行方案命名 |
| `{PIPELINE_ID}` | 绑定的底层流水线模板 ID |
| `{USER_EMAIL}` / `{CREATOR}` | 操作人邮箱或工号标识 |
| `{CUSTOM_ATTRIBUTES}` | 转义后的自定义参数结构体 JSON |

---

### 2.2 合并请求绑定 (`create_mr_binding_body`)
对应配置项：`pipeline_system.create_mr_binding_body`

| 占位符 | 说明 |
| :--- | :--- |
| `{PIPELINE_ID}` | 底层流水线 ID |
| `{SCHEME_ID}` | 执行方案 ID |
| `{REPO_URL}` | 关联的代码仓克隆 URL |
| `{BRANCHES}` | 触发 MR 检查的目标分支集合 |
| `{CREDENTIAL_ID}` | 代码仓访问凭据 ID |
| `{CUSTOM_ATTRIBUTES}` | 扩展控制属性 |

---

### 2.3 创建代码检查任务 (`create_checker_task_body`)
对应配置项：`pipeline_system.create_checker_task_body`

| 占位符 | 说明 |
| :--- | :--- |
| `{REPO_URL}` | 代码仓克隆 URL |
| `{REPO_BRANCH}` | 触发检测的目标分支 |
| `{TASK_NAME}` / `{NAME}` | 代码检查任务名称 |
| `{RULE_SETS}` | 规则集映射 JSON |

---

### 2.4 创建每日/定时构建 (`create_execution_plan_body`)
对应配置项：`pipeline_system.create_execution_plan_body`

| 占位符 | 说明 |
| :--- | :--- |
| `{PIPELINE_ID}` | 流水线 ID |
| `{SCHEME_ID}` | 执行方案 ID |
| `{DAILY_BUILD_TIME}` / `{TIME}` | 定时构建的触发时间表达式（如 `"02:00"`） |
| `{PIPELINE_NAME}` / `{NAME}` | 定时构建计划名称 |
| `{SERVICE_ID}` | 所属服务 ID |
| `{WORKSPACE_ID}` | 所属工作区 ID |

---

### 2.5 Webhook 注册 (`create_webhook_body`)
对应配置项：`pipeline_system.create_webhook_body`

| 占位符 | 说明 |
| :--- | :--- |
| `{WEBHOOK_URL}` | 本系统接收 Webhook 事件的回调地址 |
| `{REPO_ID}` | 代码仓 ID |

---

## 3. 模板使用最佳实践与示例

1. **类型匹配**：
   - 字符串类型占位符（如 `{REPO_NAME}`, `{GROUP_PATH}`, `{DESCRIPTION}`），在 JSON 模板中必须加双引号：`"{REPO_NAME}"`。
   - 数字与对象/数组类型占位符（如 `{GROUP_ID}`, `{ACCESS_LEVEL}`, `{TAG_LIST}`）：
     - 数字类型直接保留裸值：`"group_id": {GROUP_ID}` 或 `"{GROUP_ID}"`。
     - 数组类型用方括号包裹：`"tag_list": [{TAG_LIST}]`。若 `tags` 为空，系统替换为 `""` 后将自动规整为合法的 JSON 空数组 `[]`；若带有标签，则替换为 `["tag1", "tag2", "CodeShield"]`。

2. **热更新与动态调整**：
   修改 `config.yaml` 中的模板后，无需重启 Go 核心服务，可通过系统重载或新触发请求即刻生效。
