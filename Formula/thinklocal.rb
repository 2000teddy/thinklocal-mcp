# frozen_string_literal: true

# Homebrew formula for thinklocal-mcp
# Install: brew install 2000teddy/tap/thinklocal
# Or: brew tap 2000teddy/tap && brew install thinklocal
class Thinklocal < Formula
  desc "Encrypted P2P mesh network for AI CLI agents on the local network"
  homepage "https://github.com/2000teddy/thinklocal-mcp"
  url "https://github.com/2000teddy/thinklocal-mcp/archive/refs/tags/v0.30.0.tar.gz"
  sha256 "PLACEHOLDER" # Updated by release workflow
  license "MIT"

  depends_on "node@22"

  def install
    # Install npm dependencies
    system "npm", "install", "--ignore-scripts"
    cd "packages/daemon" do
      system "npm", "install"
    end

    # Install all project files
    libexec.install Dir["*"]

    # Create wrapper scripts
    (bin/"thinklocal").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node@22"].opt_bin}/node" \\
        --import tsx \\
        "#{libexec}/packages/cli/src/thinklocal.ts" "$@"
    EOS

    (bin/"tlmcp-daemon").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node@22"].opt_bin}/node" \\
        --import tsx \\
        "#{libexec}/packages/daemon/src/index.ts" "$@"
    EOS

    (bin/"tlmcp-mcp").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node@22"].opt_bin}/node" \\
        --import tsx \\
        "#{libexec}/packages/daemon/src/mcp-stdio.ts" "$@"
    EOS
  end

  # launchd service definition (ADR-029-Semantik, soweit der `brew services`-DSL es erlaubt)
  service do
    run [opt_bin/"tlmcp-daemon"]
    run_type :immediate # RunAtLoad — startet bei Service-Load / Boot
    # ADR-029: KEIN mystery-relauncher — Neustart nur bei nicht-sauberem Exit
    # (= launchd KeepAlive{SuccessfulExit:false}). Hängt davon ab, dass das Daemon bei SIGTERM/
    # bootout sauber mit Exit 0 beendet — der SIGTERM-Handler tut das (index.ts: shutdown→exit(0)),
    # daher wird ein bewusst gestopptes Daemon NICHT neu hochgezogen.
    keep_alive successful_exit: false
    working_dir var/"thinklocal"
    log_path var/"log/thinklocal/daemon.log"
    error_log_path var/"log/thinklocal/daemon-error.log"
    environment_variables TLMCP_DATA_DIR: var/"thinklocal"
  end

  def post_install
    # Create data and log directories
    (var/"thinklocal").mkpath
    (var/"log/thinklocal").mkpath
  end

  def caveats
    <<~EOS
      thinklocal-mcp Daemon wurde installiert.

      Starten:
        brew services start thinklocal
        # oder manuell:
        tlmcp-daemon

      Hinweis (ADR-029): `brew services` installiert einen PER-USER-LaunchAgent, der erst
      nach GUI-Login startet. Fuer headless/SSH-only/FileVault-Macs den System-Domain-
      LaunchDaemon-Installer nutzen (startet ohne GUI-Login, laeuft als dedizierter Nutzer):
        sudo bash #{libexec}/scripts/install.sh   # rendert /Library/LaunchDaemons + bootstrap system

      CLI-Tool:
        thinklocal status        # Status pruefen
        thinklocal doctor        # Systemdiagnose
        thinklocal peers         # Peers anzeigen
        thinklocal setup codex   # Codex CLI konfigurieren
        thinklocal setup gemini  # Gemini CLI konfigurieren

      MCP-Server fuer AI-Tools:
        thinklocal setup all     # Alle Tools konfigurieren

      Konfiguration:
        #{etc}/thinklocal/daemon.toml

      Daten:
        #{var}/thinklocal/

      Logs:
        #{var}/log/thinklocal/
    EOS
  end

  test do
    # Verify CLI starts
    assert_match "thinklocal", shell_output("#{bin}/thinklocal --help")

    # Verify daemon can show version
    assert_match version.to_s, shell_output("#{bin}/thinklocal --help 2>&1", 0)
  end
end
