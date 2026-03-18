export GO111MODULE=on
export PATH := $(PATH):$(GOPATH)/bin

DIST_ROOT := dist
DIST_PATH := $(DIST_ROOT)/plugin

all: dist

dist: webapp/dist server/dist
	@echo "Creating distribution directory"
	rm -rf $(DIST_PATH)
	mkdir -p $(DIST_PATH)/webapp
	mkdir -p $(DIST_PATH)/server
	cp plugin.json $(DIST_PATH)/
	cp webapp/dist/com.yourdomain.scheduler_bundle.js $(DIST_PATH)/webapp/
	cp server/dist/plugin-linux-amd64 $(DIST_PATH)/server/
	cd $(DIST_ROOT) && tar -czf plugin.tar.gz plugin

webapp/dist:
	@echo "Building webapp"
	cd webapp && npm install && npm run build

server/dist:
	@echo "Building server"
	cd server && go mod init mattermost-plugin-scheduler 2>/dev/null || true
	cd server && go mod tidy
	cd server && go build -o dist/plugin-linux-amd64

clean:
	rm -rf dist
	rm -rf webapp/node_modules
	rm -rf webapp/dist
	rm -rf server/dist

.PHONY: all dist clean
