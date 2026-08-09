package database

import (
	"fmt"
	"io"
	"log"
	"os"
	"time"

	"code-pipeline/models"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/datatypes"
	"gorm.io/driver/postgres"
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

	dsn := models.AppConfig.Database.GetDSN()
	log.Printf("[Database] Connecting to PostgreSQL database (%s)...", models.AppConfig.Database.DBName)
	dialector := postgres.New(postgres.Config{
		DSN:                  dsn,
		PreferSimpleProtocol: true,
	})

	DB, err = gorm.Open(dialector, &gorm.Config{
		Logger:                                   newLogger,
		DisableForeignKeyConstraintWhenMigrating: true,
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

	// 补全已存在数据行中为空或 NULL 的字段，防止 AutoMigrate 增加 NOT NULL 约束失败
	_ = DB.Exec("UPDATE users SET email = '' WHERE email IS NULL")
	_ = DB.Exec("UPDATE users SET password = '' WHERE password IS NULL")
	_ = DB.Exec("UPDATE repositories SET name = '' WHERE name IS NULL")
	_ = DB.Exec("UPDATE pipelines SET pipeline_id = '' WHERE pipeline_id IS NULL")
	_ = DB.Exec("UPDATE pipelines SET name = '' WHERE name IS NULL")
	_ = DB.Exec("UPDATE pipelines SET type = '' WHERE type IS NULL")
	_ = DB.Exec("UPDATE execution_schemes SET branchs = '' WHERE branchs IS NULL")
	_ = DB.Exec("UPDATE execution_schemes SET pipeline_id = 0 WHERE pipeline_id IS NULL")
	_ = DB.Exec("UPDATE managed_groups SET name = '' WHERE name IS NULL")
	_ = DB.Exec("UPDATE managed_groups SET path = '' WHERE path IS NULL")
	_ = DB.Exec("UPDATE managed_groups SET full_path = '' WHERE full_path IS NULL")
	_ = DB.Exec("UPDATE managed_repositories SET managed_group_id = 0 WHERE managed_group_id IS NULL")
	_ = DB.Exec("UPDATE managed_repositories SET name = '' WHERE name IS NULL")
	_ = DB.Exec("UPDATE managed_repositories SET ssh_url = '' WHERE ssh_url IS NULL")
	_ = DB.Exec("UPDATE managed_member_accesses SET principal_type = '' WHERE principal_type IS NULL")
	_ = DB.Exec("UPDATE managed_member_accesses SET principal_id = 0 WHERE principal_id IS NULL")
	_ = DB.Exec("UPDATE managed_member_accesses SET access_level = 0 WHERE access_level IS NULL")
	// 迁移旧版 managed_branch_monitors 表中的遗留列 branch，并清理该列及其 NOT NULL 约束
	_ = DB.Exec("UPDATE managed_branch_monitors SET branch_name = branch WHERE (branch_name IS NULL OR branch_name = '') AND branch IS NOT NULL AND branch != ''")
	_ = DB.Exec("ALTER TABLE managed_branch_monitors DROP COLUMN IF EXISTS branch")

	_ = DB.Exec("UPDATE managed_branch_monitors SET managed_repository_id = 0 WHERE managed_repository_id IS NULL")
	_ = DB.Exec("UPDATE managed_branch_monitors SET branch_name = '' WHERE branch_name IS NULL")

	log.Println("[Database] AutoMigrating database schema...")
	err = DB.AutoMigrate(
		&models.User{},
		&models.Department{},
		&models.Repository{},
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
		"CREATE INDEX IF NOT EXISTS idx_er_task_type ON execution_reports(task_type)",
		"CREATE INDEX IF NOT EXISTS idx_er_status ON execution_reports(status)",
	}
	for _, sqlIdx := range sqlIndices {
		if err := DB.Exec(sqlIdx).Error; err != nil {
			log.Printf("[Database] Failed to create index: %s, error: %v", sqlIdx, err)
		} else {
			log.Printf("[Database] Checked/Created index successfully: %s", sqlIdx)
		}
	}

	// PostgreSQL 自增 Sequence 修正，防止 SQLite 数据迁移至 PostgreSQL 后主键 Sequence 滞后引发插入主键冲突
	if DB.Dialector.Name() == "postgres" {
		tables := []string{
			"users",
			"departments",
			"subsystems",
			"repositories",
			"pipelines",
			"execution_schemes",
			"mr_events",
			"managed_groups",
			"managed_repositories",
			"managed_member_accesses",
			"managed_branch_monitors",
			"execution_reports",
		}
		for _, tbl := range tables {
			seqSQL := fmt.Sprintf("SELECT setval(pg_get_serial_sequence('%s', 'id'), COALESCE((SELECT MAX(id) FROM %s), 1), (SELECT COUNT(*) > 0 FROM %s))", tbl, tbl, tbl)
			if err := DB.Exec(seqSQL).Error; err != nil {
				log.Printf("[Database] Failed to sync sequence for table %s: %v", tbl, err)
			}
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
