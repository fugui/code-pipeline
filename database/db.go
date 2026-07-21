package database

import (
	"io"
	"log"
	"os"
	"time"

	"code-pipeline/models"

	"github.com/glebarez/sqlite"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func InitDB() {
	var err error

	var logWriter io.Writer = os.Stdout
	logFile, errFile := os.OpenFile("slow_sql.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	if errFile == nil {
		logWriter = io.MultiWriter(os.Stdout, logFile)
		log.Println("[Database] Slow SQL logger initialized with log file: slow_sql.log")
	} else {
		log.Printf("[Database] Failed to open slow_sql.log: %v. Fallback to stdout.", errFile)
	}

	newLogger := logger.New(
		log.New(logWriter, "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             200 * time.Millisecond,
			LogLevel:                  logger.Warn,
			IgnoreRecordNotFoundError: true,
			Colorful:                  false,
		},
	)

	DB, err = gorm.Open(sqlite.Open("code_pipeline.db"), &gorm.Config{
		Logger: newLogger,
	})
	if err != nil {
		log.Fatalf("[Database] Failed to connect database: %v", err)
	}

	// 显式删除旧的 idx_mg_repo 单列唯一索引，以便重新建立基于 (managed_group_id, name) 的联合唯一索引
	if err := DB.Exec("DROP INDEX IF EXISTS idx_mg_repo").Error; err != nil {
		log.Printf("[Database] Failed to drop old idx_mg_repo index: %v", err)
	} else {
		log.Println("[Database] Checked and removed unique index idx_mg_repo successfully")
	}

	log.Println("[Database] AutoMigrating database schema (code_pipeline.db)...")
	err = DB.AutoMigrate(
		&models.User{},
		&models.Repository{},
		&models.Pipeline{},
		&models.ExecutionScheme{},
		&models.MrEvent{},
		&models.ManagedGroup{},
		&models.ManagedRepository{},
		&models.ManagedMemberAccess{},
		&models.ManagedBranchMonitor{},
	)
	if err != nil {
		log.Fatalf("[Database] Migration failed: %v", err)
	}

	// 显式删除旧数据库上残存的 managed_groups.path 全局唯一索引，解除同名子组的冲突
	if err := DB.Exec("DROP INDEX IF EXISTS idx_managed_groups_path").Error; err != nil {
		log.Printf("[Database] Failed to drop old path unique index: %v", err)
	} else {
		log.Println("[Database] Checked and removed unique index on managed_groups.path successfully")
	}

	// 显式创建新增索引以防旧表未成功迁移索引
	sqlIndices := []string{
		"CREATE INDEX IF NOT EXISTS idx_repositories_service_group ON repositories(service_group)",
		"CREATE INDEX IF NOT EXISTS idx_repositories_owner_name ON repositories(owner_name)",
		"CREATE INDEX IF NOT EXISTS idx_repositories_is_active ON repositories(is_active)",
		"CREATE INDEX IF NOT EXISTS idx_es_repo_branch ON execution_schemes(repository_id, branch)",
		"CREATE INDEX IF NOT EXISTS idx_mbm_repo_status ON managed_branch_monitors(managed_repository_id, status)",
		"CREATE INDEX IF NOT EXISTS idx_mma_lookup ON managed_member_accesses(source_type, source_id, principal_type, principal_id)",
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_mg_repo ON managed_repositories(managed_group_id, name)",
	}
	for _, sqlIdx := range sqlIndices {
		if err := DB.Exec(sqlIdx).Error; err != nil {
			log.Printf("[Database] Failed to create index: %s, error: %v", sqlIdx, err)
		} else {
			log.Printf("[Database] Checked/Created index successfully: %s", sqlIdx)
		}
	}

	// Seed admin user
	var count int64
	DB.Model(&models.User{}).Count(&count)
	if count == 0 {
		hashed, _ := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
		admin := models.User{
			Email:    "admin@code-shield.com",
			Name:     "管理员",
			Password: string(hashed),
			IsAdmin:  true,
			IsActive: true,
		}
		if err := DB.Create(&admin).Error; err != nil {
			log.Printf("[Database] Failed to seed default admin: %v", err)
		} else {
			log.Println("[Database] Seeded default admin user (email: admin@code-shield.com, password: admin123)")
		}
	}
}
