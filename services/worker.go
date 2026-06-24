package services

import (
	"context"
	"log"
	"sync"
)

var (
	taskQueue   chan uint
	activeTasks map[uint]context.CancelFunc
	tasksMu     sync.Mutex
)

func StartWorkerPool(workerCount int) {
	taskQueue = make(chan uint, 1000)
	activeTasks = make(map[uint]context.CancelFunc)

	for i := 0; i < workerCount; i++ {
		go worker(i)
	}
	log.Printf("[WorkerPool] Started %d workers", workerCount)
}

func EnqueueTask(logID uint) {
	taskQueue <- logID
}

func CancelTask(logID uint) bool {
	tasksMu.Lock()
	cancel, exists := activeTasks[logID]
	tasksMu.Unlock()

	if exists {
		cancel()
		return true
	}
	return false
}

func registerActiveTask(logID uint, cancel context.CancelFunc) {
	tasksMu.Lock()
	activeTasks[logID] = cancel
	tasksMu.Unlock()
}

func deregisterActiveTask(logID uint) {
	tasksMu.Lock()
	delete(activeTasks, logID)
	tasksMu.Unlock()
}

func worker(id int) {
	for logID := range taskQueue {
		ctx, cancel := context.WithCancel(context.Background())
		registerActiveTask(logID, cancel)

		// 执行流水线逻辑
		RunPipeline(ctx, logID)

		cancel()
		deregisterActiveTask(logID)
	}
}
func GetTaskQueueState() (int, []uint) {
	tasksMu.Lock()
	defer tasksMu.Unlock()
	running := make([]uint, 0, len(activeTasks))
	for k := range activeTasks {
		running = append(running, k)
	}
	return len(taskQueue), running
}
