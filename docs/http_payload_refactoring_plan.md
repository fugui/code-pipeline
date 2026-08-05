# CodePipeline 上游调用方与 HTTP Payload 契约统一重构设计方案 📐

- **设计人**: Antigravity AI & CodePipeline 开发组
- **状态**: 待检视 (Draft / Review Required)
- **目标组件**: `utils/http.go`, `utils/template.go`, `services/codehub_client.go`, `services/pipeline_client.go`

---

## 1. 背景与痛点分析

### 1.1 现状分析
在当前的 `code-pipeline` 后端服务中，与第三方 CI/CD 引擎及远程 Git 托管平台（CodeHub/GitLab）交互时，底层使用 `utils.SendHTTPRequest` 统一发送 HTTP 请求。

由于系统支持通过 `config.yaml` 动态配置 API 请求 Body 模板（例如 `create_repo_body`、`create_branch_body` 等），上游调用方在处理这些模板时存在代码范式散乱的问题：
1. **上游拼接 Raw 字符串**：调用方（如 `codehub_client.go`）在替换完模板占位符后，手写 `json.RawMessage([]byte(bodyStr))` 强塞给底层的 `SendHTTPRequest`。
2. **底层尴尬兜底**：为了兼容上游传进来的 `json.RawMessage`、`[]byte`、`string` 以及普通的 `Struct`/`Map`，底层 `SendHTTPRequest` 内部被迫使用了 `switch payload.(type)` 进行隐式兜底与类型适配。

### 1.2 现有架构痛点
* **职责倒置**：本应由上游调用方保障的“合法 Payload 构建”职责，泄露并转嫁到了底层 HTTP 传输库中。
* **类型安全缺失**：`payload interface{}` 形参无法约束上游，上游若因模板替换错误产生非法的 JSON 裸词（如 `yes` / `yaml`），错误会在底层 `json.Marshal` 时抛出，导致诊断链路模糊。
* **代码坏味道**：手写 `json.RawMessage([]byte(bodyStr))` 属于典型的不规范过度包装。

---

## 2. 重构架构设计 (Architecture Design)

### 2.1 整体架构设计图

```
+-----------------------------------------------------------------------------------+
|                            上游调用方 (Callers / Services)                         |
|   (services/codehub_client.go, services/pipeline_client.go, token_manager.go 等)   |
+-----------------------------------------------------------------------------------+
                                         |
               +-------------------------+-------------------------+
               |                                                   |
   [场景 A: 配置模板 (YAML/JSON)]                           [场景 B: 业务 Struct/Map]
               |                                                   |
               v                                                   |
   utils.RenderJSONTemplate(template, vars)                        |
               |                                                   |
               | (校验并转换为标准 Map 对象)                       |
               +-------------------------+-------------------------+
                                         |
                                         v (统一输入: Go 标准 JSON 对象 map/struct 或 nil)
                                         |
                       +-----------------------------------+
                       | utils.SendHTTPRequest             |
                       | - 强类型契约: payload interface{} |
                       | - 纯粹职责: json.Marshal & HTTP   |
                       +-----------------------------------+
```

### 2.2 核心设计原则
1. **规范上游，纯粹底层**：底层 `SendHTTPRequest` 不再做任何 `switch payload.(type)` 兜底。`payload` 必须是标准的 Go 对象（Struct / Map）或 `nil`。
2. **显式模板渲染**：引入 `utils.RenderJSONTemplate` 独立工具函数，上游所有涉及 `config.yaml` 模板替换的操作，必须显式调用该函数解析校验并转换为 `map[string]interface{}` 后再传给底层。
3. **前置语法效验**：在 `RenderJSONTemplate` 内部反序列化时完成 JSON 语法校验，若配置模板有错，在调用方即可精准定位具体哪个配置模板有问题。

---

## 3. 组件详细设计 (Component Detail Design)

### 3.1 新增模块：`utils/template.go`
新增模板解析工具模块，提供通用且安全的模板渲染能力：

```go
package utils

import (
	"encoding/json"
	"fmt"
	"strings"
)

// RenderJSONTemplate 统一将包含 {VAR} 占位符的 JSON 配置模板解析校验，并反序列化为标准的 Go map[string]interface{}
func RenderJSONTemplate(templateStr string, vars map[string]string) (map[string]interface{}, error) {
	rendered := templateStr
	for k, v := range vars {
		placeholder := "{" + k + "}"
		rendered = strings.ReplaceAll(rendered, placeholder, v)
	}

	var resultMap map[string]interface{}
	if err := json.Unmarshal([]byte(rendered), &resultMap); err != nil {
		return nil, fmt.Errorf("invalid json config template after substitution: %w (rendered body: %s)", err, rendered)
	}

	return resultMap, nil
}
```

---

### 3.2 底层模块重构：`utils/http.go`
将 `SendHTTPRequest` 还原为极致纯粹的标准实现，删除所有 `switch payload.(type)` 兜底：

```go
// SendHTTPRequest 统一向远程接口发送 HTTP 请求，payload 必须为可序列化的 Go 对象 (Struct/Map) 或 nil
func SendHTTPRequest(ctx context.Context, method, rawURL string, payload interface{}, opt HTTPOptions, expectedStatuses []int, contextMsg string) ([]byte, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse URL %s: %v", rawURL, err)
	}

	if len(opt.QueryParams) > 0 {
		q := u.Query()
		for k, v := range opt.QueryParams {
			q.Set(k, v)
		}
		u.RawQuery = q.Encode()
	}

	var bodyReader io.Reader
	if payload != nil {
		jsonBytes, err := json.Marshal(payload)
		if err != nil {
			log.Printf("[%s] Failed to marshal request payload: %v | Raw Payload: %#v\n", contextMsg, err, payload)
			return nil, fmt.Errorf("failed to marshal request payload: %w", err)
		}
		bodyReader = bytes.NewReader(jsonBytes)
	}

	req, err := http.NewRequestWithContext(ctx, method, u.String(), bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP request: %v", err)
	}

	req.Header = make(http.Header)
	if payload != nil {
		req.Header["content-type"] = []string{"application/json"}
	}
    // ... 后续逻辑保持不变
}
```

---

### 3.3 上游调用方重构清单 (Callers Refactoring List)

#### 改造点 1: `services/codehub_client.go`
针对 Remote Git 平台 API 调用全面消除 `json.RawMessage([]byte(bodyStr))`：

| 函数 | 重构前代码模式 | 重构后代码模式 |
| :--- | :--- | :--- |
| `CreateRemoteRepo` | `bodyStr = strings.ReplaceAll(...)`<br>`json.RawMessage([]byte(bodyStr))` | `payload, err := utils.RenderJSONTemplate(models.AppConfig.CodeHub.CreateRepoBody, vars)`<br>`utils.SendHTTPRequest(..., payload, ...)` |
| `CreateRemoteBranch` | `bodyStr = strings.ReplaceAll(...)`<br>`json.RawMessage([]byte(bodyStr))` | `payload, err := utils.RenderJSONTemplate(models.AppConfig.CodeHub.CreateBranchBody, vars)`<br>`utils.SendHTTPRequest(..., payload, ...)` |
| `ConfigureBranchProtection` | `bodyStr = strings.ReplaceAll(...)`<br>`json.RawMessage([]byte(bodyStr))` | `payload, err := utils.RenderJSONTemplate(models.AppConfig.CodeHub.ConfigureProtectionBody, vars)`<br>`utils.SendHTTPRequest(..., payload, ...)` |
| `ConfigureRemoteACL` | `bodyStr = strings.ReplaceAll(...)`<br>`json.RawMessage([]byte(bodyStr))` | `payload, err := utils.RenderJSONTemplate(models.AppConfig.CodeHub.ConfigureACLBody, vars)`<br>`utils.SendHTTPRequest(..., payload, ...)` |

#### 改造点 2: `services/pipeline_client.go`
针对三方流水线对接函数清理 `json.RawMessage(bodyStr)`：

| 函数 | 涉及的配置模板 | 重构后方式 |
| :--- | :--- | :--- |
| `CreateExecutionSchemeStep` | `create_execution_scheme_body` | `utils.RenderJSONTemplate` 得到 `map[string]interface{}` 传入 |
| `CreateMRBindingStep` | `create_mr_binding_body` | `utils.RenderJSONTemplate` 得到 `map[string]interface{}` 传入 |
| `CreateCheckerTaskStep` | `create_checker_task_body` | `utils.RenderJSONTemplate` 得到 `map[string]interface{}` 传入 |
| `CreateExecutionPlanStep` | `create_execution_plan_body` | `utils.RenderJSONTemplate` 得到 `map[string]interface{}` 传入 |
| `RegisterWebhook` | `create_webhook_body` | `utils.RenderJSONTemplate` 得到 `map[string]interface{}` 传入 |
| `UpdateRepoSettings` | `update_repo_settings_body` | `utils.RenderJSONTemplate` 得到 `map[string]interface{}` 传入 |
| `UpdateExecutionScheme` | `postData` (字符串模板) | `utils.RenderJSONTemplate` 得到 `map[string]interface{}` 传入 |

---

## 4. 重构校验与测试计划 (Verification Plan)

### 4.1 单元测试 (Automated Tests)
1. **`utils/template_test.go`** (新增):
   - 测试 `RenderJSONTemplate` 正常替换场景。
   - 测试包含语法错误（如缺少引号、多余逗号）的模板，断言能否精准返回语法解析错误。
   - 测试带 `{TAG_LIST}` 的数组嵌入场景。
2. **`services/pipeline_client_test.go`** (更新):
   - 运行 `TestManagedGitPlatformAPI` 验证全链路逻辑（包含建仓、建分支、保护分支、配置 ACL）。

### 4.2 编译构建 (Build & Integration)
- 执行 `make build` 确保前后端编译与 Go 语法检查 100% 通过。
