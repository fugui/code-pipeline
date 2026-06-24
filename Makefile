.PHONY: all install build dev clean lint preview run

all: build

install:
	@echo "Installing frontend dependencies..."
	cd frontend && ( [ -d node_modules ] || npm install )

build: install
	@echo "Building frontend..."
	cd frontend && npm run build
	@echo "Building Go backend..."
	go build -o code-pipeline

run: build
	@echo "Starting code-pipeline..."
	./code-pipeline

dev: install
	@echo "Starting dev server..."
	cd frontend && npm run dev

lint: install
	@echo "Running linter..."
	cd frontend && npm run lint

preview: build
	@echo "Starting production preview..."
	cd frontend && npm run preview

clean:
	@echo "Cleaning build artifacts..."
	rm -rf frontend/dist
	rm -f code-pipeline
