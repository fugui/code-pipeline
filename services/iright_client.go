package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"code-pipeline/models"
	"code-pipeline/utils"
)

// IRightGroupAppType 表示 iRight 群组应用分类类型
type IRightGroupAppType struct {
	ID                 int    `json:"id"`
	ParentID           *int   `json:"parentID"`
	GroupAppTypeNameCn string `json:"groupAppTypeNameCn"`
	GroupAppTypeNameEn string `json:"groupAppTypeNameEn"`
	GroupAppTypeDesc   string `json:"groupAppTypeDesc"`
	SortIndex          int    `json:"sortIndex"`
	IsValid            int    `json:"isValid"`
}

// IRightGroupData 表示从 iRight 远程系统返回的群组核心业务数据
type IRightGroupData struct {
	AppName             *string              `json:"appName"`
	GroupID             string               `json:"groupID"`
	GroupNameCn         string               `json:"groupNameCn"`
	GroupNameEn         string               `json:"groupNameEn"`
	GroupType           int                  `json:"groupType"`
	GroupOwner          string               `json:"groupOwner"`
	GroupAdmin          string               `json:"groupAdmin"`
	EffectDate          string               `json:"effectDate"`
	W3Notice            int                  `json:"w3notice"`
	InvalidDate         string               `json:"invalidDate"`
	DisableDate         *string              `json:"disableDate"`
	Status              int                  `json:"status"` // 1: 正常
	Creator             string               `json:"creator"`
	CreateDate          string               `json:"createDate"`
	LastUpdateBy        string               `json:"lastUpdateBy"`
	LastUpdateDate      string               `json:"lastUpdateDate"`
	DeptProdID          string               `json:"deptProdID"`
	Remark              string               `json:"remark"`
	IsCore              int                  `json:"isCore"`
	CreateType          int                  `json:"createType"`
	AppID               string               `json:"appId"`
	DeptID              *string              `json:"deptID"`
	IsBelongToKIA       int                  `json:"isBelongToKIA"`
	FullEnglishName     string               `json:"fullEnglishName"`
	FullDeptProdCode    string               `json:"fullDeptProdCode"`
	IsManageKIA         int                  `json:"isManageKIA"`
	IsPeriodCheck       int                  `json:"isPeriodCheck"`
	GroupAppTypeInfo    []int                `json:"groupAppTypeInfo"`
	IsAllowApply        int                  `json:"isAllowApply"`
	MemberCount         int                  `json:"memberCount"`
	FullName            string               `json:"fullName"`
	SubGroupMemberCount int                  `json:"subGroupMemberCount"`
	LastCheckTime       string               `json:"lastCheckTime"`
	GroupAppTypeLs      []IRightGroupAppType `json:"groupAppTypeLs"`
	CheckPeriod         int                  `json:"checkPeriod"`
	NetworkAdmin        *string              `json:"netWorkAdmin"`
	IsMonthCheck        int                  `json:"isMonthCheck"`
}

// IRightGroupResponse 表示 iRight 群组查询 API 的统一封装响应
type IRightGroupResponse struct {
	Data    *IRightGroupData `json:"data"`
	Message string           `json:"message"`
	Status  interface{}      `json:"status"`
}

// GetIRightGroup 从 iRight 远程系统根据 groupID 实时查询群组详情与成员人数等信息
func GetIRightGroup(ctx context.Context, groupID string, contextHeaders map[string]string) (*IRightGroupData, error) {
	cleanGroupID := strings.TrimSpace(groupID)
	if cleanGroupID == "" {
		return nil, fmt.Errorf("iRight 群组 ID 不能为空")
	}

	apiURLStr := models.AppConfig.IRight.GetGroupURL
	if apiURLStr == "" {
		return nil, fmt.Errorf("iRight 查询 API 未配置 (请在 config.yaml 中配置 iright.get_group_url)")
	}

	// 替换 URL 占位符
	apiURLStr = strings.ReplaceAll(apiURLStr, "{GROUP_ID}", cleanGroupID)
	apiURLStr = strings.ReplaceAll(apiURLStr, "{ID}", cleanGroupID)
	apiURLStr = strings.ReplaceAll(apiURLStr, "{groupId}", cleanGroupID)

	// 融合 Header 配置 (预置 Header + 上下文透传 Header)
	reqHeaders := make(map[string]string)
	for k, v := range models.AppConfig.IRight.Headers {
		reqHeaders[k] = v
	}
	for k, v := range contextHeaders {
		reqHeaders[k] = v
	}

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURLStr, nil, utils.HTTPOptions{
		Headers: reqHeaders,
	}, []int{http.StatusOK}, "GetIRightGroup")
	if err != nil {
		return nil, fmt.Errorf("请求 iRight 群组详情接口失败: %w", err)
	}

	var resp IRightGroupResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		// 尝试直接作为 IRightGroupData 反序列化 (部分 API 直接返回 data 结构)
		var directData IRightGroupData
		if err2 := json.Unmarshal(body, &directData); err2 == nil && directData.GroupID != "" {
			return &directData, nil
		}
		log.Printf("[GetIRightGroup] 反序列化 iRight 响应失败: %v, Body: %s", err, string(body))
		return nil, fmt.Errorf("解析 iRight 群组数据格式失败: %w", err)
	}

	if resp.Data == nil {
		msg := resp.Message
		if msg == "" {
			msg = "未查询到匹配的 iRight 群组数据"
		}
		return nil, fmt.Errorf("%s", msg)
	}

	return resp.Data, nil
}
