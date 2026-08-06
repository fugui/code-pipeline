package utils

import (
	"strconv"
	"strings"
	"testing"
)

func TestGetRandomDailyBuildTime(t *testing.T) {
	for i := 0; i < 1000; i++ {
		timeStr := GetRandomDailyBuildTime()
		parts := strings.Split(timeStr, ":")
		if len(parts) != 2 {
			t.Fatalf("Invalid time format: %s", timeStr)
		}
		hour, err1 := strconv.Atoi(parts[0])
		minute, err2 := strconv.Atoi(parts[1])
		if err1 != nil || err2 != nil {
			t.Fatalf("Failed to parse time digits: %s", timeStr)
		}

		if minute < 0 || minute > 59 {
			t.Fatalf("Minute out of bounds [0, 59]: %d in %s", minute, timeStr)
		}

		// Hour must be in 0..7
		if hour < 0 || hour > 7 {
			t.Fatalf("Hour out of allowed range [0-7]: %d in %s", hour, timeStr)
		}
	}
}
