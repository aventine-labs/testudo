.PHONY: all build test clean build-js test-js build-jmx test-jmx

all: build test

build: build-js build-jmx

test: test-js test-jmx

build-js:
	npm run build:js

test-js:
	npm run test:js

build-jmx:
	make -C packages/testudo-jmx build

test-jmx:
	make -C packages/testudo-jmx test

clean:
	rm -rf packages/testudo-js/dist packages/testudo-jmx/bin
