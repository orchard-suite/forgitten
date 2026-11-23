SHELL := /bin/bash
PROJECT := cli/Forgitten/Forgitten.csproj
OUTPUT := publish
IMAGE := ghcr.io/orchard-suite/forgitten
VERSION := $(shell node -p "require('./package.json').version")
BINARY := forgitten
INSTALL_DIR := /usr/local/bin
PUBLISH := dotnet publish $(PROJECT) -c Release --self-contained true -p:PublishSingleFile=true

# Detect current platform
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

ifeq ($(UNAME_S),Darwin)
    ifeq ($(UNAME_M),arm64)
        RID := osx-arm64
    else
        RID := osx-x64
    endif
else ifeq ($(UNAME_S),Linux)
    ifeq ($(UNAME_M),aarch64)
        RID := linux-arm64
    else
        RID := linux-x64
    endif
endif

.PHONY: check land build test e2e clean run publish-all docker install uninstall

# Everything that must pass before a commit: hub typecheck, tests, and web build; CLI tests; CLI against a real hub.
check:
	npm run check
	dotnet test Forgitten.sln
	./scripts/e2e.sh

# Lands on main after the full check passes. From a worktree: make land BRANCH=<branch>.
land: check
	release-damnit land $(BRANCH)

# CLI
build:
	dotnet build $(PROJECT) -c Release

test:
	dotnet test Forgitten.sln

e2e:
	./scripts/e2e.sh

clean:
	dotnet clean Forgitten.sln
	rm -rf $(OUTPUT) dist

run:
	dotnet run --project $(PROJECT) -- $(ARGS)

publish-%:
	$(PUBLISH) -r $* -o $(OUTPUT)/$*

publish-all: publish-osx-arm64 publish-osx-x64 publish-linux-x64 publish-linux-arm64 publish-win-x64 publish-win-arm64

# Hub image
docker:
	docker build --platform linux/amd64 -t $(IMAGE):$(VERSION) .

# Local install/uninstall of the CLI
install: publish-$(RID)
	@echo "Installing to $(INSTALL_DIR)/$(BINARY)..."
	@sudo cp $(OUTPUT)/$(RID)/$(BINARY) $(INSTALL_DIR)/$(BINARY)
	@echo "Done! Run 'forgitten --help' to get started"

uninstall:
	@echo "Removing $(INSTALL_DIR)/$(BINARY)..."
	@sudo rm -f $(INSTALL_DIR)/$(BINARY)
	@echo "Done!"
