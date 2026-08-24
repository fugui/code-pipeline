package database

import (
	"code-common/backend/gormdb"
	"log"
	"time"

	"code-pipeline/models"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

var DB *gorm.DB

func InitDB() {
	var err error

	DB, err = gormdb.Connect(models.AppConfig.Database, gormdb.Options{
		ServiceName:   "Pipeline-DB",
		SlowThreshold: 200 * time.Millisecond,
	})
	if err != nil {
		log.Fatalf("[Database] Failed to connect database: %v", err)
	}

	log.Println("[Database] AutoMigrating database schema...")
	err = DB.AutoMigrate(
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
		&models.SysAuditLog{},
	)
	if err != nil {
		log.Fatalf("[Database] Migration failed: %v", err)
	}

	// 自动迁移并初始化默认流水线组
	migratePipelineGroups(DB)

	// Seed admin user
	var count int64
	DB.Model(&models.User{}).Count(&count)
	if count == 0 {
		hashed, _ := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
		admin := models.User{
			Email:    "admin@code-shield.com",
			Name:     "管理员",
			Password: string(hashed),
			Roles:    datatypes.JSON([]byte("[\"super_admin\"]")),
			IsActive: true,
		}
		if err := DB.Create(&admin).Error; err != nil {
			log.Printf("[Database] Failed to seed default admin: %v", err)
		} else {
			log.Println("[Database] Seeded default admin user (email: admin@code-shield.com, password: admin123)")
		}
	}

	// Seed default departments if empty
	var deptCount int64
	DB.Model(&models.Department{}).Count(&deptCount)
	if deptCount == 0 {
		defaultDepts := []string{
			"基础架构部",
			"软件研发一部",
			"软件研发二部",
			"系统测试部",
			"运维与云原生部",
			"网络与信息安全部",
		}
		for _, name := range defaultDepts {
			_ = DB.Create(&models.Department{Name: name, CreatedAt: time.Now()})
		}
		log.Println("[Database] Seeded default system departments successfully")
	}
}

// migratePipelineGroups 自动初始化默认流水线组并将孤立流水线归组
func migratePipelineGroups(db *gorm.DB) {
	defaults := []models.PipelineGroup{
		{
			GroupKey:              "mr-gate-default",
			Name:                  "默认 MR 门禁流水线组",
			Type:                  "MR",
			MaxSchemesPerPipeline: 200,
			IsActive:              true,
			Description:           "承载组织内所有代码合并请求 (MR) 自动化检查流水线资源池",
		},
		{
			GroupKey:              "daily-build-default",
			Name:                  "默认每日构建流水线组",
			Type:                  "每日构建",
			MaxSchemesPerPipeline: 200,
			IsActive:              true,
			Description:           "承载组织内所有夜间与定时每日构建流水线资源池",
		},
	}

	for _, g := range defaults {
		var existing models.PipelineGroup
		if err := db.Where("group_key = ?", g.GroupKey).First(&existing).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				if createErr := db.Create(&g).Error; createErr == nil {
					log.Printf("[Database] Seeded default pipeline group: %s (%s)\n", g.Name, g.GroupKey)
				}
			}
		}
	}

	// 将现有没有归属组的流水线，按照其 Type 自动归入对应默认组
	for _, g := range defaults {
		var savedGroup models.PipelineGroup
		if err := db.Where("group_key = ?", g.GroupKey).First(&savedGroup).Error; err == nil {
			// 匹配对应类型的未归组流水线
			db.Model(&models.Pipeline{}).
				Where("type LIKE ? AND (group_id IS NULL OR group_id = 0)", "%"+savedGroup.Type+"%").
				Update("group_id", savedGroup.ID)
		}
	}

	// 统一初始化所有 status 为空或为未设置状态的流水线为 active
	db.Model(&models.Pipeline{}).
		Where("status = '' OR status IS NULL").
		Update("status", "active")
}
