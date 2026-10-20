{
  pkgs,
  lib,
  config,
  inputs,
  ...
}:

let
  # Single source of truth for the Python side. Moves to apps/api/ when the
  # clinical app is scaffolded; for now the demo app in reference/ uses the
  # same set.
  pythonRequirements = builtins.readFile ./requirements.txt;
in
{
  packages = [
    pkgs.git
    pkgs.ripgrep
    pkgs.fd
    pkgs.jq
    pkgs.sqlite
    pkgs.curl
    pkgs.gnumake
  ];

  languages.python = {
    enable = true;
    version = "3.12";
    venv = {
      enable = true;
      requirements = pythonRequirements;
    };
  };

  # The agent microservice (pi-durable) is TypeScript/Node 22 — same major as
  # mason. Pinned here so both services share one shell.
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
  };

  services.postgres = {
    enable = true;
    listen_addresses = "127.0.0.1";
    port = 5432;
    initialDatabases = [
      {
        name = "compass";
        user = "compass";
        pass = "compass";
      }
    ];
  };

  scripts.setup.exec = ''
    set -euo pipefail
    echo "[setup] python: $(python --version)"
    echo "[setup] node:   $(node --version)"
    echo "[setup] python packages already provisioned by devenv venv"
    if [ -f package.json ]; then
      echo "[setup] installing node workspace dependencies"
      npm install
    fi
    echo "[setup] done. Try: compass-mockup"
  '';

  # The vendored mockup, run in place. SQLite, demo mode, loopback only.
  # 8010 by default: 8000 is commonly taken by other local dev servers.
  scripts.compass-mockup.exec = ''
    set -euo pipefail
    cd reference/mockup/clinical_compass_app
    export COMPASS_PORT="''${COMPASS_PORT:-8010}"
    COMPASS_DEMO=1 exec python run_demo.py
  '';

  # Same, but drops the demo database first so seeds re-apply cleanly.
  scripts.compass-mockup-reset.exec = ''
    set -euo pipefail
    cd reference/mockup/clinical_compass_app
    rm -rf data
    export COMPASS_PORT="''${COMPASS_PORT:-8010}"
    COMPASS_DEMO=1 exec python run_demo.py
  '';

  scripts.compass-test.exec = ''
    set -euo pipefail
    if [ -d apps/api ]; then
      python -m pytest apps/api -q
    else
      echo "no apps/api yet"
    fi
  '';

  enterShell = ''
    echo "clinical-compass dev shell"
    echo "  python $(python --version 2>&1 | cut -d' ' -f2)  node $(node --version)"
    echo "  postgres: postgresql://compass:compass@127.0.0.1:5432/compass (devenv up)"
    echo "  scripts:  setup, compass-mockup, compass-mockup-reset"
  '';
}
