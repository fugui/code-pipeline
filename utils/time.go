package utils

import (
	"fmt"
	"math/rand"
	"time"
)

func init() {
	rand.Seed(time.Now().UnixNano())
}

// GetRandomDailyBuildTime 生成晚上 22:00 到次日 08:00 之间的随机时间 (HH:mm)
// 时间范围覆盖 22:00-23:59 (120分钟) 和 00:00-07:59 (480分钟)，共 600 分钟
func GetRandomDailyBuildTime() string {
	totalMinutes := rand.Intn(600) // 0 ~ 599
	var hour, minute int
	if totalMinutes < 120 {
		hour = 22 + totalMinutes/60
		minute = totalMinutes % 60
	} else {
		offset := totalMinutes - 120
		hour = offset / 60
		minute = offset % 60
	}
	return fmt.Sprintf("%02d:%02d", hour, minute)
}
