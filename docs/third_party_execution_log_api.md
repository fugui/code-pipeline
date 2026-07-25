# code-pipeline 第三方系统构建与代码检查日志上报 API 规范

## 1. 概述与适用场景
本文档为第三方系统（包括但不限于 CI/CD 引擎、构建 Runner、代码扫描/静态检查服务等）向 `code-pipeline` 系统汇报任务执行日志、状态及汇总指标的接口规范。

第三方系统在执行由 `code-pipeline` 触发或由代码托管平台 Hook 触发的**构建任务 (Build)** 或 **代码检查任务 (Code Check)** 时，须按照本规范提交执行状态与结果。

---

## 2. 接口基本信息

- **服务地址**: `http://<code-pipeline-host>:<port>` （默认生产/测试环境端口为 `:8082`）
- **接口路径**:
  - 统一上报端点: `POST /api/v1/report/execution-log`
  - 构建任务专属端点 (别名): `POST /api/v1/report/build-log`
  - 代码检查专属端点 (别名): `POST /api/v1/report/code-check-log`
- **请求数据格式**: `application/json`
- **字符编码**: `UTF-8`
- **认证机制**: 在 HTTP Header 中添加鉴权 Token：
  - `X-Report-Token: <Token>` 或 `Authorization: Bearer <Token>`

---

## 3. 任务类型一：构建任务 (Build) API 规范

当第三方构建系统执行完代码编译、构建、打包或发布流程后，通过此 API 汇报日志。

### 3.1 请求 Body (`JSON`)
```json
{
  "task_id": "build_task_20260724_001",
  "task_type": "build",
  "repo_url": "http://192.168.56.18:9080/tech/infra/auth-service.git",
  "branch": "feature/auth-v2",
  "commit_id": "a1b2c3d4e5f678901234567890abcdef12345678",
  "execution_scheme_id": "scheme_102",
  "pipeline_id": "pipe_dev_01",
  "status": "success",
  "start_time": "2026-07-24T14:00:00Z",
  "end_time": "2026-07-24T14:02:15Z",
  "duration_sec": 135,
  "trigger_type": "webhook",
  "trigger_user": "zhangsan",
  "build_details": {
    "artifact_name": "auth-service-v2.0.1.tar.gz",
    "artifact_url": "http://192.168.56.18:9080/artifacts/auth-service-v2.0.1.tar.gz",
    "artifact_size": 45120890,
    "compiler": "go1.22.4 linux/amd64",
    "steps": [
      { "name": "Git Checkout", "status": "success", "duration_sec": 5 },
      { "name": "Compile Binary", "status": "success", "duration_sec": 90 },
      { "name": "Package Artifact", "status": "success", "duration_sec": 40 }
    ]
  },
  "log_content": "2026-07-24 14:00:01 [INFO] Starting build job...\n2026-07-24 14:02:10 [INFO] Build success.",
  "external_log_url": "http://192.168.56.18:9080/pipelines/build-logs/build_task_20260724_001"
}
```

### 3.2 字段说明
| 字段名 | 类型 | 必填 | 格式/示例 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `task_id` | String | **是** | `"build_task_20260724_001"` | 第三方系统中的任务执行唯一 ID / 构建编号 |
| `task_type` | String | **是** | `"build"` | 固定填写 `build` |
| `repo_url` | String | **是** | `"http://.../repo.git"` | 关联代码仓库的完整 HTTP/SSH 克隆地址 |
| `branch` | String | **是** | `"main"` / `"feature/..."` | Git 分支名称 |
| `commit_id` | String | 否 | `"a1b2c3d4..."` | 触发本次构建的 Git Commit SHA (40位) |
| `execution_scheme_id` | String | 否 | `"scheme_102"` | `code-pipeline` 系统中的执行方案 ID |
| `pipeline_id` | String | 否 | `"pipe_dev_01"` | 关联的流水线 ID |
| `status` | String | **是** | `"success"` | 状态枚举: `running`, `success`, `failed`, `cancelled`, `timeout` |
| `start_time` | String | 否 | `"2026-07-24T14:00:00Z"` | ISO 8601 / RFC3339 格式的启动时间 |
| `end_time` | String | 否 | `"2026-07-24T14:02:15Z"` | ISO 8601 / RFC3339 格式的完成时间 |
| `duration_sec` | Int64 | 否 | `135` | 任务总耗时（秒） |
| `trigger_type` | String | 否 | `"webhook"` | 触发来源: `manual`, `mr`, `daily_build`, `webhook` |
| `trigger_user` | String | 否 | `"zhangsan"` | 触发构建的操作人姓名或账号 |
| `build_details` | Object | 否 | 如下 | 构建特定细节结构体 |
| ↳ `artifact_name` | String | 否 | `"auth-service.tar.gz"` | 构建产物文件名 |
| ↳ `artifact_url` | String | 否 | `"http://..."` | 构建包/产物直接下载 URL |
| ↳ `artifact_size` | Int64 | 否 | `45120890` | 构建产物字节数 |
| ↳ `compiler` | String | 否 | `"go1.22.4"` | 编译工具链与平台版本 |
| ↳ `steps` | Array | 否 | `[{"name": "...", ...}]` | 构建子步骤明细列表 |
| `log_content` | String | 否 | `"2026-07-24..."` | 构建控制台原始日志文本内容 |
| `external_log_url` | String | 否 | `"http://..."` | 第三方系统原生日志查看页面 URL |

---

## 4. 任务类型二：代码检查任务 (Code Check) API 规范

当第三方静态代码分析系统/安全检查引擎执行完扫描任务后，通过此 API 汇报结果。

### 4.1 请求 Body (`JSON`)
```json
{
  "task_id": "check_task_20260724_002",
  "task_type": "code_check",
  "code_checker_task_id": "checker_task_8891",
  "repo_url": "http://192.168.56.18:9080/tech/infra/auth-service.git",
  "branch": "feature/auth-v2",
  "commit_id": "a1b2c3d4e5f678901234567890abcdef12345678",
  "execution_scheme_id": "scheme_102",
  "pipeline_id": "pipe_dev_01",
  "status": "success",
  "start_time": "2026-07-24T14:00:00Z",
  "end_time": "2026-07-24T14:01:30Z",
  "duration_sec": 90,
  "trigger_type": "mr",
  "trigger_user": "lisi",
  "code_check_details": {
    "gate_status": "passed",
    "lines_scanned": 15420,
    "files_scanned": 86,
    "total_issues": 4,
    "critical_issues": 1,
    "major_issues": 3,
    "minor_issues": 0,
    "suggest_issues": 0,
    "code_duplication_rate": "1.2%",
    "checker_report_url": "http://192.168.56.18:9080/shield/public/report/checker_task_8891"
  },
  "log_content": "2026-07-24 14:00:01 [INFO] Starting static code analysis...\n2026-07-24 14:01:28 [INFO] Scan finished. Total issues found: 4.",
  "external_log_url": "http://192.168.56.18:9080/pipelines/check-logs/check_task_20260724_002"
}
```

### 4.2 字段说明
| 字段名 | 类型 | 必填 | 格式/示例 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `task_id` | String | **是** | `"check_task_20260724_002"` | 第三方系统中的扫描任务唯一 ID |
| `task_type` | String | **是** | `"code_check"` | 固定填写 `code_check` |
| `code_checker_task_id` | String | 否 | `"checker_task_8891"` | `code-pipeline` 或检查工具中的任务规则模板 ID |
| `repo_url` | String | **是** | `"http://.../repo.git"` | 关联代码仓库的完整 HTTP/SSH 克隆地址 |
| `branch` | String | **是** | `"main"` / `"feature/..."` | Git 分支名称 |
| `commit_id` | String | 否 | `"a1b2c3d4..."` | 触发扫描的 Git Commit SHA (40位) |
| `execution_scheme_id` | String | 否 | `"scheme_102"` | `code-pipeline` 中的执行方案 ID |
| `pipeline_id` | String | 否 | `"pipe_dev_01"` | 关联的流水线 ID |
| `status` | String | **是** | `"success"` | 状态枚举: `running`, `success`, `failed`, `cancelled`, `timeout` |
| `start_time` | String | 否 | `"2026-07-24T14:00:00Z"` | ISO 8601 / RFC3339 格式启动时间 |
| `end_time` | String | 否 | `"2026-07-24T14:01:30Z"` | ISO 8601 / RFC3339 格式完成时间 |
| `duration_sec` | Int64 | 否 | `90` | 扫描任务耗时（秒） |
| `trigger_type` | String | 否 | `"mr"` | 触发来源: `manual`, `mr`, `daily_build`, `webhook` |
| `trigger_user` | String | 否 | `"lisi"` | 触发扫描的用户 |
| `code_check_details` | Object | 否 | 如下 | 代码检查特有指标数据 |
| ↳ `gate_status` | String | 否 | `"passed"` / `"failed"` | 代码质量门禁判定结果 |
| ↳ `lines_scanned` | Int64 | 否 | `15420` | 扫描的代码总行数 |
| ↳ `files_scanned` | Int64 | 否 | `86` | 扫描的文件总数 |
| ↳ `total_issues` | Int | 否 | `4` | 发现的缺陷/问题总数量 |
| ↳ `fatal_issues` | Int | 否 | `0` | 致命级 (Fatal/Blocker) 问题数量 |
| ↳ `critical_issues` | Int | 否 | `1` | 严重级 (Critical) 问题数量 |
| ↳ `major_issues` | Int | 否 | `3` | 一般级 (Major) 问题数量 |
| ↳ `minor_issues` | Int | 否 | `0` | 提示级 (Minor/Info) 问题数量 |
| ↳ `code_duplication_rate` | String | 否 | `"1.2%"` | 代码重复率百分比 |
| ↳ `cyclomatic_complexity` | Float | 否 | `3.8` | 平均圈复杂度 |
| ↳ `checker_report_url` | String | 否 | `"http://..."` | 缺陷扫描报告在线查看链接 |
| `log_content` | String | 否 | `"2026-07-24..."` | 扫描工具控制台日志文本 |
| `external_log_url` | String | 否 | `"http://..."` | 第三方系统原生扫描日志页面 URL |

---

## 5. 响应规范

### 5.1 成功响应 (HTTP 200 OK)
```json
{
  "code": 0,
  "message": "Execution log report accepted successfully",
  "data": {
    "report_id": 1058,
    "task_id": "check_task_20260724_002",
    "task_type": "code_check",
    "status": "success",
    "created_at": "2026-07-24T14:32:30Z"
  }
}
```

### 5.2 失败响应
- **HTTP 400 Bad Request** (缺少必填字段或 JSON 解析错误):
```json
{
  "code": 4001,
  "error": "Invalid request body: missing required field 'repo_url'"
}
```
- **HTTP 401 Unauthorized** (Token 验证失败):
```json
{
  "code": 4010,
  "error": "Invalid or missing X-Report-Token header"
}
```
- **HTTP 500 Internal Server Error** (服务器内部存储异常):
```json
{
  "code": 5000,
  "error": "Failed to save execution log report"
}
```

---

## 6. cURL 请求示例速查

### 构建日志上报示例
```bash
curl -X POST http://192.168.56.18:8082/api/v1/report/build-log \
  -H "Content-Type: application/json" \
  -H "X-Report-Token: your-secret-token" \
  -d '{
    "task_id": "b_1001",
    "task_type": "build",
    "repo_url": "http://192.168.56.18:9080/tech/infra/auth-service.git",
    "branch": "master",
    "commit_id": "9f8e7d6c5b4a3210",
    "status": "success",
    "duration_sec": 120,
    "build_details": {
      "artifact_name": "app.bin",
      "artifact_url": "http://192.168.56.18:9080/downloads/app.bin"
    },
    "log_content": "Build succeeded."
  }'
```

### 代码检查日志上报示例
```bash
curl -X POST http://192.168.56.18:8082/api/v1/report/code-check-log \
  -H "Content-Type: application/json" \
  -H "X-Report-Token: your-secret-token" \
  -d '{
    "task_id": "c_2001",
    "task_type": "code_check",
    "code_checker_task_id": "checker_88",
    "repo_url": "http://192.168.56.18:9080/tech/infra/auth-service.git",
    "branch": "master",
    "commit_id": "9f8e7d6c5b4a3210",
    "status": "success",
    "duration_sec": 45,
    "code_check_details": {
      "gate_status": "passed",
      "total_issues": 2,
      "fatal_issues": 0,
      "critical_issues": 0,
      "major_issues": 2
    },
    "log_content": "Code check passed cleanly."
  }'
```
