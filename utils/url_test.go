package utils

import (
	"testing"
)

func TestSSHToHTTPS(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{
			input:    "git@github.com:my-org/my-target-repo.git",
			expected: "https://github.com/my-org/my-target-repo",
		},
		{
			input:    "git@github.com:22/my-org/my-target-repo.git",
			expected: "https://github.com/my-org/my-target-repo",
		},
		{
			input:    "ssh://git@github.com/my-org/my-target-repo.git",
			expected: "https://github.com/my-org/my-target-repo",
		},
		{
			input:    "ssh://git@github.com:22/my-org/my-target-repo.git",
			expected: "https://github.com/my-org/my-target-repo",
		},
		{
			input:    "ssh:git@github.com:22/my-org/my-target-repo.git",
			expected: "https://github.com/my-org/my-target-repo",
		},
		{
			input:    "git@my-git-server.example.com:foo/bar.git",
			expected: "https://my-server.example.com/foo/bar",
		},
		{
			input:    "https://github.com/org/repo",
			expected: "https://github.com/org/repo",
		},
		{
			input:    "http://github.com/org/repo",
			expected: "http://github.com/org/repo",
		},
		{
			input:    "  ",
			expected: "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			actual := SSHToHTTPS(tc.input)
			if actual != tc.expected {
				t.Errorf("SSHToHTTPS(%q) = %q; expected %q", tc.input, actual, tc.expected)
			}
		})
	}
}

func TestNormalizeGitURL(t *testing.T) {
	testCases := []struct {
		url      string
		expected string
	}{
		{"git@github.com:Google/Gemini.git", "github.com/google/gemini"},
		{"https://github.com/Google/Gemini", "github.com/google/gemini"},
		{"http://192.168.56.18:8000/org/repo.git", "192.168.56.18/org/repo"},
		{"ssh://git@192.168.56.18:22/org/repo.git", "192.168.56.18/org/repo"},
		{"192.168.56.18/org/repo", "192.168.56.18/org/repo"},
		{"http://192.168.56.18/org/repo", "192.168.56.18/org/repo"},
		{"git@192.168.56.18:org/repo.git", "192.168.56.18/org/repo"},
	}

	for _, tc := range testCases {
		result := NormalizeGitURL(tc.url)
		if result != tc.expected {
			t.Errorf("NormalizeGitURL(%q) = %q, expected %q", tc.url, result, tc.expected)
		}
	}
}
