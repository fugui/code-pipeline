package utils

import (
	"fmt"
	"math/rand"
	"time"
)

func init() {
	rand.Seed(time.Now().UnixNano())
}

// GetRandomDailyBuildTime 生成凌晨 00:00 到 08:00 之间的随机时间 (HH:mm)
// 时间范围覆盖 00:00-07:59，共 480 分钟
func GetRandomDailyBuildTime() string {
	totalMinutes := rand.Intn(480) // 0 ~ 479
	hour := totalMinutes / 60
	minute := totalMinutes % 60
	return fmt.Sprintf("%02d:%02d", hour, minute)
}
