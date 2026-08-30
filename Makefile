BINARY          := code-pipeline
FRONTEND_DIR    := frontend
DIST_DIR        := $(FRONTEND_DIR)/dist
NODE_MODULES    := $(FRONTEND_DIR)/node_modules

COMMON_DIR      := ../code-common/frontend/src
COMMON_SRCS     := $(shell find $(COMMON_DIR) -type f 2>/dev/null)

# 自动收集前端与后端源码依赖
FRONTEND_SRCS   := $(shell find $(FRONTEND_DIR) -type f -not -path "*/node_modules/*" -not -path "*/dist/*" 2>/dev/null) $(COMMON_SRCS)
BACKEND_SRCS    := $(shell find . -type f \( -name "*.go" -o -name "go.mod" -o -name "go.sum" \) -not -path "*/$(FRONTEND_DIR)/*" -not -path "*/.git/*")

.PHONY: all install build frontend backend dev clean lint preview run

# 默认运行目标
all: build

# 完整打包构建
build: $(BINARY)

# 依赖安装 (node_modules)
install: $(NODE_MODULES)

$(NODE_MODULES): $(FRONTEND_DIR)/package.json
	@echo "Installing frontend dependencies..."
	cd $(FRONTEND_DIR) && ( [ -d node_modules ] || npm install )
	@touch $(NODE_MODULES)

# 编译构建前端静态资产 (dist/)
frontend: $(DIST_DIR)

$(DIST_DIR): $(NODE_MODULES) $(FRONTEND_SRCS)
	@echo "Building frontend..."
	cd $(FRONTEND_DIR) && npm run build
	@touch $(DIST_DIR)

# 编译后端可执行文件
backend: $(BINARY)

$(BINARY): $(BACKEND_SRCS) $(DIST_DIR)
	@echo "Building Go backend..."
	go build -o $(BINARY)

# 快捷启动命令
run: build
	@echo "Starting $(BINARY)..."
	./$(BINARY)

# 启动本地开发调试服务器
dev: $(NODE_MODULES)
	@echo "Starting dev server..."
	cd $(FRONTEND_DIR) && npm run dev

# 执行代码风格与语法检查
lint: $(NODE_MODULES)
	@echo "Running linter..."
	cd $(FRONTEND_DIR) && npm run lint

# 启动本地生产预览
preview: $(DIST_DIR)
	@echo "Starting production preview..."
	cd $(FRONTEND_DIR) && npm run preview

# 清理构建产物
clean:
	@echo "Cleaning build artifacts..."
	rm -rf $(DIST_DIR) $(BINARY)
