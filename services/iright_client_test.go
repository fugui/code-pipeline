package services

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"code-pipeline/models"
)

func TestGetIRightGroup_Success(t *testing.T) {
	mockResponseJSON := `{
		"data": {
			"appName": null,
			"groupID": "B95D36E3-7CB0-4B50-901C-C2A1982241B3",
			"groupNameCn": "XGLS-SW_LTCOMM-Committer",
			"groupNameEn": "XGLS-SW_LTCOMM-Committer",
			"groupType": 2,
			"groupOwner": "liping 00005055",
			"groupAdmin": "liwenjun 00015676",
			"effectDate": "2026-08-12 16:42:57",
			"w3notice": 1,
			"invalidDate": "2028-08-31 23:59:59",
			"disableDate": null,
			"status": 1,
			"creator": "liwenjun 00015676",
			"createDate": "2026-08-12 16:42:57",
			"lastUpdateBy": "liping 00005055",
			"lastUpdateDate": "2026-08-19 16:43:16",
			"deptProdID": "100002",
			"remark": "LT-XY/SW/LTComm 代码库组织Commtter群组",
			"isCore": 0,
			"createType": 2,
			"appId": "00000000000000000000000000000676",
			"deptID": null,
			"isBelongToKIA": 0,
			"fullEnglishName": "新凯来\\装备业务一部",
			"fullDeptProdCode": "100001\\100002",
			"isManageKIA": 0,
			"isPeriodCheck": 0,
			"groupAppTypeInfo": [20],
			"isAllowApply": 1,
			"memberCount": 13,
			"fullName": "新凯来\\装备业务一部",
			"subGroupMemberCount": 0,
			"lastCheckTime": "2026-08-19 16:43:16",
			"groupAppTypeLs": [
				{
					"id": 20,
					"parentID": null,
					"groupAppTypeNameCn": "IAM群组",
					"groupAppTypeNameEn": "IAM Group",
					"groupAppTypeDesc": "IAM群组",
					"sortIndex": 0,
					"isValid": 1
				}
			],
			"checkPeriod": 0,
			"netWorkAdmin": null,
			"isMonthCheck": 1
		},
		"message": "success",
		"status": 200
	}`

	var receivedAuthHeader string
	var receivedCustomHeader string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAuthHeader = r.Header.Get("Authorization")
		receivedCustomHeader = r.Header.Get("X-User-Token")

		if r.URL.Path != "/api/v1/iright/groups/B95D36E3-7CB0-4B50-901C-C2A1982241B3" {
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "not found"})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(mockResponseJSON))
	}))
	defer server.Close()

	// 设置 Config
	models.AppConfig.IRight.GetGroupURL = server.URL + "/api/v1/iright/groups/{GROUP_ID}"
	models.AppConfig.IRight.Headers = map[string]string{
		"Accept": "application/json",
	}

	userHeaders := http.Header{}
	userHeaders.Set("Authorization", "Bearer test-user-jwt")
	userHeaders.Set("X-User-Token", "custom-token-xyz")

	data, err := GetIRightGroup(context.Background(), "B95D36E3-7CB0-4B50-901C-C2A1982241B3", userHeaders)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	if data.GroupID != "B95D36E3-7CB0-4B50-901C-C2A1982241B3" {
		t.Errorf("expected groupID B95D36E3-7CB0-4B50-901C-C2A1982241B3, got %s", data.GroupID)
	}
	if data.GroupNameCn != "XGLS-SW_LTCOMM-Committer" {
		t.Errorf("expected groupNameCn XGLS-SW_LTCOMM-Committer, got %s", data.GroupNameCn)
	}
	if data.MemberCount != 13 {
		t.Errorf("expected memberCount 13, got %d", data.MemberCount)
	}
	if data.GroupOwner != "liping 00005055" {
		t.Errorf("expected groupOwner liping 00005055, got %s", data.GroupOwner)
	}

	// 检查 Header 传递
	if receivedAuthHeader != "Bearer test-user-jwt" {
		t.Errorf("expected Authorization header 'Bearer test-user-jwt', got '%s'", receivedAuthHeader)
	}
	if receivedCustomHeader != "custom-token-xyz" {
		t.Errorf("expected X-User-Token header 'custom-token-xyz', got '%s'", receivedCustomHeader)
	}
}

func TestGetIRightGroup_EmptyConfig(t *testing.T) {
	models.AppConfig.IRight.GetGroupURL = ""
	_, err := GetIRightGroup(context.Background(), "TEST-UUID", nil)
	if err == nil {
		t.Fatalf("expected error when GetGroupURL is empty, got nil")
	}
}
