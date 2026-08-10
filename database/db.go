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
