package models

import (
	"strings"

	"gorm.io/gorm"
)

// AfterFind GORM 生命周期钩子：从数据库中查询出 Pipeline 实体后，自动为其拼装生成可供前端跳转的外部链接。
// 将该钩子与 models.go 数据模型定义分离，保证模型的只读纯净性与可维护性。
func (p *Pipeline) AfterFind(tx *gorm.DB) (err error) {
	tmpl := AppConfig.PipelineSystem.PipelineLinkTemplate
	if tmpl == "" {
		return nil
	}

	// 进行占位符鲁棒的大小写兼容性变量替换
	res := tmpl
	res = strings.ReplaceAll(res, "{workspaceId}", p.WorkspaceID)
	res = strings.ReplaceAll(res, "{WORKSPACE_ID}", p.WorkspaceID)
	res = strings.ReplaceAll(res, "{workspace_id}", p.WorkspaceID)

	res = strings.ReplaceAll(res, "{ServiceID}", p.ServiceID)
	res = strings.ReplaceAll(res, "{SERVICE_ID}", p.ServiceID)
	res = strings.ReplaceAll(res, "{serviceId}", p.ServiceID)
	res = strings.ReplaceAll(res, "{service_id}", p.ServiceID)

	res = strings.ReplaceAll(res, "{PipelineID}", p.PipelineID)
	res = strings.ReplaceAll(res, "{PIPELINE_ID}", p.PipelineID)
	res = strings.ReplaceAll(res, "{pipelineId}", p.PipelineID)
	res = strings.ReplaceAll(res, "{pipeline_id}", p.PipelineID)

	p.WebURL = res
	return nil
}
