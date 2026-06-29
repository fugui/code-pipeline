package database

import (
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
	newLogger := logger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             time.Second,
			LogLevel:                  logger.Warn,
			IgnoreRecordNotFoundError: true,
			Colorful:                  true,
		},
	)

	DB, err = gorm.Open(sqlite.Open("code_pipeline.db"), &gorm.Config{
		Logger: newLogger,
	})
	if err != nil {
		log.Fatalf("[Database] Failed to connect database: %v", err)
	}

	log.Println("[Database] AutoMigrating database schema (code_pipeline.db)...")
	err = DB.AutoMigrate(
		&models.User{},
		&models.Repository{},
		&models.Pipeline{},
		&models.ExecutionPlan{},
	)
	if err != nil {
		log.Fatalf("[Database] Migration failed: %v", err)
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
