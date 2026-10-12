BINARY_NAME=bin/testudo-jmx

.PHONY: all build test lint clean run

all: build test

build:
	@mkdir -p bin
	go build -ldflags="-s -w" -o $(BINARY_NAME) ./cmd/testudo-jmx

test:
	go test -v -race ./...

lint:
	go vet ./...

clean:
	rm -rf bin/ dist/

run: build
	./$(BINARY_NAME) --help
