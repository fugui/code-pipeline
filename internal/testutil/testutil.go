package testutil

import "code-pipeline/models"

// PipelineModels 返回 code-pipeline 的全部业务模型，供测试在独立临时库中执行 AutoMigrate。
// 集中维护一份，避免各个 *_test.go 文件重复罗列导致遗漏或漂移。
func PipelineModels() []interface{} {
	return []interface{}{
		&models.User{},
		&models.Department{},
		&models.Repository{},
		&models.PipelineGroup{},
		&models.Pipeline{},
		&models.ExecutionScheme{},
		&models.MrEvent{},
		&models.ManagedGroup{},
		&models.ManagedRepository{},
		&models.ManagedMemberAccess{},
		&models.ManagedBranchMonitor{},
		&models.ExecutionReport{},
		&models.ManagedRepoApproval{},
		&models.ManagedBatchBranchLog{},
		&models.ManagedProtectedBranchRule{},
		&models.ComplianceBaseline{},
		&models.RepoComplianceReport{},
		&models.ManagedCommitterGroup{},
		&models.SysAuditLog{},
	}
}
