package services

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestPathTraversalSafety(t *testing.T) {
	sandboxDir := "/home/fugui/codes/code-pipeline/workspace"

	testCases := []struct {
		name     string
		repoName string
		expected bool // true if allowed, false if blocked
	}{
		{"Normal Repo", "my-project", true},
		{"Repo with spaces", "my project", true},
		{"Traversal attempt 1", "../outside", false},
		{"Traversal attempt 2", "sub/../../outside", false},
		{"Partial name bypass", "../workspace-malicious", false},
	}

	sandboxAbs, err := filepath.Abs(sandboxDir)
	if err != nil {
		t.Fatalf("Failed to resolve sandbox path: %v", err)
	}

	sandboxPrefix := sandboxAbs
	if !strings.HasSuffix(sandboxPrefix, string(filepath.Separator)) {
		sandboxPrefix += string(filepath.Separator)
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			repoDir := filepath.Join(sandboxAbs, tc.repoName)
			repoDirClean := filepath.Clean(repoDir)

			isSafe := strings.HasPrefix(repoDirClean, sandboxPrefix)
			if isSafe != tc.expected {
				t.Errorf("For repoName %q, expected isSafe=%t, got %t (cleaned path: %q, sandbox prefix: %q)", tc.repoName, tc.expected, isSafe, repoDirClean, sandboxPrefix)
			}
		})
	}
}
