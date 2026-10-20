"""User-invoked local launcher. Creates only a local environment and synthetic demo."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.request
import venv
import webbrowser

ROOT = Path(__file__).resolve().parent
APP = ROOT / "clinical_compass_app"
CHECK_ONLY = "--check" in sys.argv


def main():
    if sys.version_info < (3, 10):
        print("Python 3.10 or newer is required. Install Python 3.10+ from python.org, then run START_DEMO.cmd again.")
        return 1
    if not (APP / "run_demo.py").is_file():
        print("Extract the WHOLE archive before launching, then run START_DEMO.cmd from the extracted folder.")
        return 1
    python = ROOT / ".venv" / "Scripts" / "python.exe"
    if CHECK_ONLY:
        # QA can explicitly use the caller's installed environment, without installing anything.
        if "--use-current-environment" in sys.argv:
            python = Path(sys.executable)
        if not python.is_file():
            print("Local environment not created yet. Run START_DEMO.cmd first.")
            return 1
        return subprocess.run([str(python), str(APP / "manage.py"), "check"], cwd=ROOT).returncode
    if not python.is_file():
        print("Preparing local Python environment...")
        venv.EnvBuilder(with_pip=True).create(ROOT / ".venv")
    print("Checking application dependencies (internet may be needed on first launch)...")
    result = subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(APP / "requirements.txt")], cwd=ROOT)
    if result.returncode:
        print("Dependency installation failed. Copy the last lines of this window for the technical participant.")
        return result.returncode
    env = os.environ.copy()
    # This review launcher is specifically for the synthetic loopback demo.
    env.update({"COMPASS_DEMO": "1", "COMPASS_DB": "sqlite"})
    env.setdefault("COMPASS_PORT", "8000")
    port = int(env["COMPASS_PORT"])
    if not 1024 <= port <= 65535:
        print("COMPASS_PORT must be between 1024 and 65535.")
        return 1
    url = f"http://127.0.0.1:{port}/"
    try:
        with urllib.request.urlopen(url + "health/", timeout=1) as response:
            import json
            health = json.load(response)
        if health.get("version") == "0.3.0" and health.get("assessment_module") == "demo_only":
            print("A compatible demo is already running on this computer: " + url)
            if env.get("COMPASS_OPEN_BROWSER", "1") != "0":
                webbrowser.open(url)
            return 0
        print("The port is occupied by another service. Choose COMPASS_PORT=8001 or close that service.")
        return 1
    except (OSError, ValueError):
        pass

    def open_when_ready():
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(url + "health/", timeout=1) as response:
                    if response.status == 200:
                        if env.get("COMPASS_OPEN_BROWSER", "1") != "0":
                            webbrowser.open(url)
                        return
            except OSError:
                pass
            time.sleep(0.4)

    if env.get("COMPASS_OPEN_BROWSER", "1") != "0":
        threading.Thread(target=open_when_ready, daemon=True).start()
    print("Keep this window open. Stop the server with Ctrl+C. " + url)
    try:
        return subprocess.run([str(python), str(APP / "run_demo.py")], cwd=ROOT, env=env).returncode
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
