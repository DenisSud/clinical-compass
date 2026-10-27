{
  pkgs,
  lib,
  config,
  inputs,
  ...
}:

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
    venv.enable = true;
  };

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
  };

  # Хранилище это SQLite; отдельный сервис базы не нужен.
  env.SQLITE_DB = "var/app.db";

  enterShell = ''
    echo "clinical-compass dev shell"
    echo "  python $(python --version 2>&1 | cut -d' ' -f2)  node $(node --version)"
    echo "  sqlite $(sqlite3 --version | cut -d' ' -f1)  db: $SQLITE_DB"
  '';
}
