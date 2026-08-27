package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/services"

	"github.com/gin-gonic/gin"
)

func setupCommitterTestDB(t *testing.T) {
	gin.SetMode(gin.TestMode)
	_ = models.LoadConfig("../config.yaml")
	database.InitDB()

	// 清理测试残留数据
	database.DB.Exec("DELETE FROM managed_committer_groups WHERE name LIKE 'TEST-%'")
}

func TestManagedCommitterGroupCRUD(t *testing.T) {
	setupCommitterTestDB(t)

	// 1. 测试创建 Committer Group
	createReq := CreateManagedCommitterGroupReq{
		Name:            "TEST-CORE-ENGINE-COMMITTERS",
		Level:           "L1-公司级",
		IRightGroupName: "IRIGHT-CORE-GROUP",
		IRightGroupID:   "3fa85f64-5717-4562-b3fc-2c963f66afa6",
		MemberCount:     12,
		Description:     "核心引擎研发 Committer 治理群组",
	}

	body, _ := json.Marshal(createReq)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodPost, "/managed-repos/committer-groups", bytes.NewBuffer(body))
	c.Request.Header.Set("Content-Type", "application/json")

	CreateManagedCommitterGroup(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("Expected status 201 Created, got %d: %s", w.Code, w.Body.String())
	}

	var created models.ManagedCommitterGroup
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if created.Name != "TEST-CORE-ENGINE-COMMITTERS" || created.IRightGroupID != "3fa85f64-5717-4562-b3fc-2c963f66afa6" {
		t.Fatalf("Unexpected created fields: %+v", created)
	}

	// 2. 测试查询列表
	w = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodGet, "/managed-repos/committer-groups?q=TEST-CORE", nil)

	GetManagedCommitterGroups(c)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var listResp struct {
		Items []models.ManagedCommitterGroup `json:"items"`
		Total int64                          `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("Failed to parse list response: %v", err)
	}

	if listResp.Total < 1 || len(listResp.Items) < 1 {
		t.Fatalf("Expected at least 1 item in list, got %d (total: %d)", len(listResp.Items), listResp.Total)
	}

	// 3. 测试查询单个详情
	w = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(int(created.ID))}}
	c.Request, _ = http.NewRequest(http.MethodGet, "/managed-repos/committer-groups/"+strconv.Itoa(int(created.ID)), nil)

	GetManagedCommitterGroup(c)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	// 4. 测试更新 Committer Group
	updateReq := CreateManagedCommitterGroupReq{
		Name:            "TEST-CORE-ENGINE-COMMITTERS-UPDATED",
		Level:           "L2-产品线/域级",
		IRightGroupName: "IRIGHT-CORE-GROUP-V2",
		IRightGroupID:   "7ca95f64-5717-4562-b3fc-2c963f66afa7",
		MemberCount:     15,
		Description:     "更新后的描述说明",
	}
	updateBody, _ := json.Marshal(updateReq)
	w = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(int(created.ID))}}
	c.Request, _ = http.NewRequest(http.MethodPut, "/managed-repos/committer-groups/"+strconv.Itoa(int(created.ID)), bytes.NewBuffer(updateBody))
	c.Request.Header.Set("Content-Type", "application/json")

	UpdateManagedCommitterGroup(c)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status 200 OK for update, got %d: %s", w.Code, w.Body.String())
	}

	var updated models.ManagedCommitterGroup
	_ = json.Unmarshal(w.Body.Bytes(), &updated)
	if updated.Name != "TEST-CORE-ENGINE-COMMITTERS-UPDATED" || updated.Level != "L2-产品线/域级" {
		t.Fatalf("Update failed: %+v", updated)
	}

	// 5. 测试删除 Committer Group
	w = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(int(created.ID))}}
	c.Request, _ = http.NewRequest(http.MethodDelete, "/managed-repos/committer-groups/"+strconv.Itoa(int(created.ID)), nil)

	DeleteManagedCommitterGroup(c)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status 200 OK for delete, got %d: %s", w.Code, w.Body.String())
	}

	// 6. 验证已被删除
	var check models.ManagedCommitterGroup
	if err := database.DB.First(&check, created.ID).Error; err == nil {
		t.Fatalf("Expected record to be deleted, but still exists")
	}
}

func TestGetIRightGroupHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"data": {
				"groupID": "B95D36E3-7CB0-4B50-901C-C2A1982241B3",
				"groupNameCn": "XGLS-SW_LTCOMM-Committer",
				"memberCount": 13,
				"groupOwner": "liping 00005055",
				"groupAdmin": "liwenjun 00015676",
				"fullName": "新凯来\\装备业务一部",
				"status": 1
			},
			"message": "success",
			"status": 200
		}`))
	}))
	defer mockServer.Close()

	models.AppConfig.IRight.GetGroupURL = mockServer.URL + "/api/v1/iright/groups/{GROUP_ID}"

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: "B95D36E3-7CB0-4B50-901C-C2A1982241B3"}}
	c.Request, _ = http.NewRequest(http.MethodGet, "/managed-repos/iright/groups/B95D36E3-7CB0-4B50-901C-C2A1982241B3", nil)
	c.Request.Header.Set("Authorization", "Bearer test-token")

	GetIRightGroup(c)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data    services.IRightGroupData `json:"data"`
		Message string                   `json:"message"`
		Status  int                      `json:"status"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if resp.Data.GroupID != "B95D36E3-7CB0-4B50-901C-C2A1982241B3" || resp.Data.GroupNameCn != "XGLS-SW_LTCOMM-Committer" || resp.Data.MemberCount != 13 {
		t.Fatalf("Unexpected parsed data: %+v", resp.Data)
	}
}

