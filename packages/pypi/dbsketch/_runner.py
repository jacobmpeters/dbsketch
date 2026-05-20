import os
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

NODE_VERSION = "20.19.1"
_CACHE_DIR = Path.home() / ".cache" / "dbsketch"

_PLATFORM_PKGS = {
    ("Linux",   "x86_64"):  f"node-v{NODE_VERSION}-linux-x64",
    ("Linux",   "aarch64"): f"node-v{NODE_VERSION}-linux-arm64",
    ("Darwin",  "x86_64"):  f"node-v{NODE_VERSION}-darwin-x64",
    ("Darwin",  "arm64"):   f"node-v{NODE_VERSION}-darwin-arm64",
    ("Windows", "AMD64"):   f"node-v{NODE_VERSION}-win-x64",
}


def _system_node():
    node = shutil.which("node")
    if not node:
        return None
    try:
        r = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=5)
        major = int(r.stdout.strip().lstrip("v").split(".")[0])
        return node if major >= 20 else None
    except Exception:
        return None


def _cached_node():
    system = platform.system()
    machine = platform.machine()
    key = (system, machine)
    if key not in _PLATFORM_PKGS:
        raise RuntimeError(
            f"Unsupported platform: {system} {machine}. "
            "Install Node.js 20+ manually and ensure it is on your PATH."
        )

    pkg = _PLATFORM_PKGS[key]
    node_bin = (
        _CACHE_DIR / pkg / "node.exe"
        if system == "Windows"
        else _CACHE_DIR / pkg / "bin" / "node"
    )

    if node_bin.exists():
        return str(node_bin)

    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if system == "Windows":
        url = f"https://nodejs.org/dist/v{NODE_VERSION}/{pkg}.zip"
        archive = _CACHE_DIR / f"{pkg}.zip"
    else:
        url = f"https://nodejs.org/dist/v{NODE_VERSION}/{pkg}.tar.gz"
        archive = _CACHE_DIR / f"{pkg}.tar.gz"

    print(f"dbsketch: downloading Node.js {NODE_VERSION} ({system}/{machine})...", file=sys.stderr)
    urllib.request.urlretrieve(url, archive)

    if system == "Windows":
        with zipfile.ZipFile(archive) as z:
            z.extractall(_CACHE_DIR)
    else:
        with tarfile.open(archive, "r:gz") as t:
            t.extractall(_CACHE_DIR)

    archive.unlink()
    if system != "Windows":
        node_bin.chmod(0o755)

    return str(node_bin)


def main():
    cli_js = Path(__file__).parent / "_bin" / "cli.cjs"
    if not cli_js.exists():
        print("dbsketch: bundled CLI not found — this is a packaging bug.", file=sys.stderr)
        sys.exit(1)

    node = _system_node()
    if node is None:
        try:
            node = _cached_node()
        except RuntimeError as e:
            print(f"dbsketch: {e}", file=sys.stderr)
            sys.exit(1)

    result = subprocess.run([node, str(cli_js)] + sys.argv[1:])
    sys.exit(result.returncode)
