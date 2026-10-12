BINARY_NAME=bin/testudo-jmx
PLATFORMS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64

.PHONY: all build test lint clean run cross-compile

all: build test

build:
	@mkdir -p bin
	go build -ldflags="-s -w" -o $(BINARY_NAME) ./cmd/testudo-jmx

cross-compile:
	@mkdir -p bin/platforms
	@for platform in $(PLATFORMS); do \
		OS=$$(echo $$platform | cut -d'/' -f1); \
		ARCH=$$(echo $$platform | cut -d'/' -f2); \
		EXT=""; \
		if [ "$$OS" = "windows" ]; then EXT=".exe"; fi; \
		OUT="bin/platforms/testudo-jmx-$$OS-$$ARCH$$EXT"; \
		echo "Building $$OUT..."; \
		CGO_ENABLED=0 GOOS=$$OS GOARCH=$$ARCH go build -ldflags="-s -w" -o $$OUT ./cmd/testudo-jmx; \
	done
	@cp bin/platforms/testudo-jmx-linux-amd64 bin/testudo-jmx

test:
	go test -v -race ./...

lint:
	go vet ./...

clean:
	rm -rf bin/ dist/

run: build
	./$(BINARY_NAME) --help
