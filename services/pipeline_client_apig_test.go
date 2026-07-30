package services

import (
	"testing"
)

func TestParseMRBindingID(t *testing.T) {
	tests := []struct {
		name     string
		jsonBody string
		expected string
	}{
		{
			name:     "Result Array Format",
			jsonBody: `{"result":[{"id":"4905d72ada95452abba895d293dd61ba","codeUrl":"https://repo-git.com/test.git"}],"message":"save_success","status":"success"}`,
			expected: "4905d72ada95452abba895d293dd61ba",
		},
		{
			name:     "Result Single Object Format",
			jsonBody: `{"result":{"id":"single_object_id_123"},"status":"ok"}`,
			expected: "single_object_id_123",
		},
		{
			name:     "Direct Root ID Format",
			jsonBody: `{"id":"root_id_456"}`,
			expected: "root_id_456",
		},
		{
			name:     "Direct Array Format",
			jsonBody: `[{"id":"array_id_789"}]`,
			expected: "array_id_789",
		},
		{
			name:     "Entity Format",
			jsonBody: `{"entity":{"id":"entity_id_abc"}}`,
			expected: "entity_id_abc",
		},
		{
			name:     "Failed Response Empty Result",
			jsonBody: `{"result":[],"message":"failed to add webhook in repository ,check to see if you have administrator rights in repository","status":"failed"}`,
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseMRBindingID([]byte(tt.jsonBody))
			if got != tt.expected {
				t.Errorf("ParseMRBindingID() = %q, expected %q", got, tt.expected)
			}
		})
	}
}
