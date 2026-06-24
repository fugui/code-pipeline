package services

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"
)

func RunPipeline(ctx context.Context, logID uint) {
	var execLog models.ExecutionLog
	if err := database.DB.First(&execLog, logID).Error; err != nil {
		log.Printf("[Runner] Execution log %d not found: %v", logID, err)
		return
	}

	var repo models.Repository
	if err := database.DB.First(&repo, execLog.RepoID).Error; err != nil {
		log.Printf("[Runner] Repository %d not found: %v", execLog.RepoID, err)
		updateLogStatus(logID, "failed", "", "", fmt.Sprintf("Repository not found: %v", err))
		return
	}

	log.Printf("[Runner] Starting pipeline for repo %s (Branch: %s, LogID: %d)", repo.Name, execLog.Branch, logID)

	// 更新状态为 running
	now := time.Now()
	repo.LastRunStatus = "running"
	repo.LastRunTime = &now
	database.DB.Save(&repo)

	execLog.Status = "running"
	execLog.StartTime = now
	database.DB.Save(&execLog)

	// 1. 安全验证工作路径
	sandboxAbs, err := filepath.Abs(models.AppConfig.Server.SandboxDir)
	if err != nil {
		failPipeline(logID, &repo, &execLog, fmt.Sprintf("Invalid sandbox path: %v", err))
		return
	}

	// 确保沙箱根目录存在
	if err := os.MkdirAll(sandboxAbs, 0755); err != nil {
		failPipeline(logID, &repo, &execLog, fmt.Sprintf("Failed to create sandbox: %v", err))
		return
	}

	repoDir := filepath.Join(sandboxAbs, repo.Name)
	repoDirClean := filepath.Clean(repoDir)

	sandboxPrefix := sandboxAbs
	if !strings.HasSuffix(sandboxPrefix, string(filepath.Separator)) {
		sandboxPrefix += string(filepath.Separator)
	}

	if !strings.HasPrefix(repoDirClean, sandboxPrefix) {
		failPipeline(logID, &repo, &execLog, fmt.Sprintf("Security violation: path traversal detected for repo: %s", repo.Name))
		return
	}

	// 2. 拉取或更新代码
	var gitLog string
	if _, err := os.Stat(repoDirClean); os.IsNotExist(err) {
		gitLog, err = runGitCommand(ctx, "", "clone", "-b", execLog.Branch, repo.GitURL, repoDirClean)
		if err != nil {
			failPipeline(logID, &repo, &execLog, fmt.Sprintf("Git clone failed: %v\nOutput:\n%s", err, gitLog))
			return
		}
	} else {
		// 已经存在，更新代码
		_, _ = runGitCommand(ctx, repoDirClean, "remote", "set-url", "origin", repo.GitURL)
		gitLog, err = runGitCommand(ctx, repoDirClean, "fetch", "origin")
		if err != nil {
			failPipeline(logID, &repo, &execLog, fmt.Sprintf("Git fetch failed: %v\nOutput:\n%s", err, gitLog))
			return
		}

		gitLog, err = runGitCommand(ctx, repoDirClean, "checkout", execLog.Branch)
		if err != nil {
			failPipeline(logID, &repo, &execLog, fmt.Sprintf("Git checkout failed: %v\nOutput:\n%s", err, gitLog))
			return
		}

		gitLog, err = runGitCommand(ctx, repoDirClean, "reset", "--hard", "origin/"+execLog.Branch)
		if err != nil {
			failPipeline(logID, &repo, &execLog, fmt.Sprintf("Git reset failed: %v\nOutput:\n%s", err, gitLog))
			return
		}
	}

	// 3. 执行构建命令
	var buildLog string
	var buildErr error
	if repo.BuildCmd != "" {
		log.Printf("[Runner] Running build command for %s: %s", repo.Name, repo.BuildCmd)
		buildLog, buildErr = runCommand(ctx, repoDirClean, repo.BuildCmd)
		if buildErr != nil {
			execLog.BuildLog = buildLog
			failPipeline(logID, &repo, &execLog, fmt.Sprintf("Build command failed: %v", buildErr))
			return
		}
	}

	// 4. 执行检查命令
	var checkLog string
	var checkErr error
	if repo.CheckCmd != "" {
		log.Printf("[Runner] Running check command for %s: %s", repo.Name, repo.CheckCmd)
		checkLog, checkErr = runCommand(ctx, repoDirClean, repo.CheckCmd)
		if checkErr != nil {
			execLog.BuildLog = buildLog
			execLog.CheckLog = checkLog
			failPipeline(logID, &repo, &execLog, fmt.Sprintf("Check command failed: %v", checkErr))
			return
		}
	}

	// 5. 运行成功
	endTime := time.Now()
	duration := int64(endTime.Sub(execLog.StartTime).Seconds())

	execLog.Status = "success"
	execLog.BuildLog = buildLog
	execLog.CheckLog = checkLog
	execLog.EndTime = &endTime
	execLog.DurationSec = duration
	database.DB.Save(&execLog)

	repo.LastRunStatus = "success"
	database.DB.Save(&repo)

	log.Printf("[Runner] Pipeline success for repo %s (LogID: %d)", repo.Name, logID)
}

func failPipeline(logID uint, repo *models.Repository, execLog *models.ExecutionLog, errMsg string) {
	endTime := time.Now()
	duration := int64(endTime.Sub(execLog.StartTime).Seconds())

	execLog.Status = "failed"
	execLog.ErrorMsg = errMsg
	execLog.EndTime = &endTime
	execLog.DurationSec = duration
	database.DB.Save(execLog)

	repo.LastRunStatus = "failed"
	database.DB.Save(repo)

	log.Printf("[Runner] Pipeline failed for repo %s (LogID: %d): %s", repo.Name, logID, errMsg)
}

func updateLogStatus(logID uint, status string, buildLog string, checkLog string, errMsg string) {
	var execLog models.ExecutionLog
	if err := database.DB.First(&execLog, logID).Error; err == nil {
		endTime := time.Now()
		execLog.Status = status
		if buildLog != "" {
			execLog.BuildLog = buildLog
		}
		if checkLog != "" {
			execLog.CheckLog = checkLog
		}
		execLog.ErrorMsg = errMsg
		execLog.EndTime = &endTime
		execLog.DurationSec = int64(endTime.Sub(execLog.StartTime).Seconds())
		database.DB.Save(&execLog)
	}
}

func runGitCommand(ctx context.Context, dir string, args ...string) (string, error) {
	// git 命令是硬编码的可信二进制
	cmd := exec.CommandContext(ctx, "git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	var outBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &outBuf
	err := cmd.Run()
	return outBuf.String(), err
}

func runCommand(ctx context.Context, dir string, cmdStr string) (string, error) {
	if cmdStr == "" {
		return "", nil
	}
	// 执行 CI 构建/检查脚本：设置 10 分钟单步骤硬超时防止死循环挂起
	timeoutCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(timeoutCtx, "bash", "-c", cmdStr)
	cmd.Dir = dir

	var outBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &outBuf
	err := cmd.Run()
	return outBuf.String(), err
}
