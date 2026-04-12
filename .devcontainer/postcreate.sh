#!/bin/bash
# Post-creation setup script for the development container
set -e

echo "=========================================="
echo "Starting devcontainer post-creation setup"
echo "=========================================="

# Fix apt sources issue with yarn (copied from reference container)
echo "Cleaning up apt sources..."
sudo rm -f /etc/apt/sources.list.d/yarn.list

# Update apt and install utilities
echo "Installing system dependencies..."
sudo apt-get update
sudo apt-get install -y git-flow

# Setup git aliases
echo "Configuring git aliases..."
bash .devcontainer/setup-git-aliases.sh

# Install CLI tools that are distributed via npm
if command -v npm >/dev/null 2>&1; then
    echo "Installing Claude Code CLI..."
    npm install -g @anthropic-ai/claude-code || true
    echo "Installing OpenAI Codex..."
    npm install -g @openai/codex || true
else
    echo "npm not available, skipping npm-based CLI installs."
fi

# Install beads
echo "Installing beads..."
curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/v0.49.6/scripts/install.sh | bash

# Install uv (Astral) and GitHub spec-kit via uv tool
# uv provides a universal version manager; we install via official script
if ! command -v uv >/dev/null 2>&1; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
else
    echo "uv already installed, skipping."
fi

# use uv to install github spec-kit command-line tool
if command -v uv >/dev/null 2>&1; then
    echo "Installing github spec-kit via uv..."
    uv tool install specify-cli --from git+https://github.com/github/spec-kit.git || true
else
    echo "uv not available, cannot install spec-kit."
fi

# Install keyring dependencies for integration tests (credential-store suite)
sudo apt-get install -y gnome-keyring libsecret-tools xvfb xdotool python3-dbus python3-gi

# Initialise the GNOME Keyring default collection so credential-store
# integration tests can run without a real desktop session.
bash /workspaces/automata-cli/scripts/setup-keyring.sh || true

# ── tokensave: semantic code intelligence for Claude Code ──────────────
# Downloads the latest prebuilt binary, configures the Claude Code MCP
# integration (server, hooks, permissions, prompt rules), and indexes
# the repository so the knowledge graph is ready on first session.
echo "Installing tokensave..."
TOKENSAVE_TAG=$(curl -sI https://github.com/aovestdipaperino/tokensave/releases/latest | grep -i '^location:' | sed 's|.*/tag/||;s/\r//')
TOKENSAVE_VERSION="${TOKENSAVE_TAG#v}"
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    TOKENSAVE_ARCH="aarch64-linux"
else
    TOKENSAVE_ARCH="x86_64-linux"
fi
TOKENSAVE_URL="https://github.com/aovestdipaperino/tokensave/releases/download/${TOKENSAVE_TAG}/tokensave-${TOKENSAVE_TAG}-${TOKENSAVE_ARCH}.tar.gz"
echo "  Downloading tokensave ${TOKENSAVE_VERSION} (${TOKENSAVE_ARCH})..."
curl -sL "$TOKENSAVE_URL" -o /tmp/tokensave.tar.gz
tar xzf /tmp/tokensave.tar.gz -C /tmp
sudo mv /tmp/tokensave /usr/local/bin/tokensave
rm -f /tmp/tokensave.tar.gz
echo "  tokensave $(tokensave --version) installed."

# Configure Claude Code integration (MCP server, hooks, permissions, prompt rules)
echo "  Configuring tokensave for Claude Code..."
tokensave install --agent claude || true

# Enable global save statistics
tokensave enable-upload-counter || true

# Index the repository
echo "  Indexing repository..."
tokensave sync || true

echo "  tokensave setup complete."