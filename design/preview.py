"""Serve the design and inspect Zephyr module inputs on this computer."""
import argparse
import json
import os
import re
import subprocess
import tempfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
LIMIT = 1024 * 1024
METADATA = ("zephyr/module.yml", "zephyr/module.yaml")
LEGACY = ("zephyr/CMakeLists.txt", "zephyr/Kconfig")
ASSETS = {p.name for p in ROOT.iterdir() if p.suffix in {".html", ".js", ".css", ".svg", ".png", ".md"}}
ASSETS.add("vendor/js-yaml/js-yaml.min.js")


def inspect_directory(location, workspace=None):
    root = Path(location).expanduser()
    if not root.is_absolute():
        if workspace is None:
            raise ValueError("请用 --workspace 指定项目根目录以解析相对路径，或选本地目录。")
        root = workspace / root
    if not root.is_dir():
        raise ValueError("目录不存在或不可读。")
    for name in METADATA:
        file = root / name
        if file.is_file():
            with file.open("rb") as stream:
                data = stream.read(LIMIT + 1)
            if len(data) > LIMIT:
                raise ValueError("模块描述文件过大。")
            return dict(root=root.name, file=name, yaml=data.decode("utf-8-sig"))
    if all((root / file).is_file() for file in LEGACY):
        return dict(root=root.name, legacy=True)
    raise ValueError("目录中没有 Zephyr 模块入口。请选择模块根目录。")


def git(directory, *args):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="never",
               GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=yes",
               GIT_ALLOW_PROTOCOL="http:https:ssh")
    result = subprocess.run(["git", "-C", directory, *args], capture_output=True,
                            timeout=45, env=env, check=False)
    if result.returncode:
        raise ValueError("Git 无法读取仓库或版本，请检查地址、revision 及本机 Git 凭据。")
    return result.stdout


def resolve_page(directory, route, tail):
    if route not in ("tree", "blob") or not tail or len(tail) > 2048:
        raise ValueError("网页链接缺少分支或版本。")
    names = git(directory, "ls-remote", "--heads", "--tags", "origin").decode().splitlines()
    refs = [line.split("\t")[1].split("/", 2)[2] for line in names]
    first = tail.partition("/")[0]
    if first == "HEAD" or re.fullmatch("[a-fA-F0-9]{7,40}", first):
        refs.append(first)
    prefix = max((ref for ref in refs if tail == ref or tail.startswith(ref + "/")), key=len, default=None)
    if not prefix:
        raise ValueError("网页所指的分支、标签或提交不存在。")
    subdir = tail[len(prefix):].strip("/")
    if route == "blob":
        marker = next((m for m in (*METADATA, *LEGACY) if subdir == m or subdir.endswith("/" + m)), None)
        if not marker:
            raise ValueError("请选择仓库、模块目录或 Zephyr 模块入口文件的网页。")
        subdir = subdir[:-len(marker)].rstrip("/")
    if any(p in (".", "..") for p in subdir.split("/")) or re.search(r'[\x00-\x1f\\:;*?\[\]"]', subdir):
        raise ValueError("模块子目录无效。")
    return prefix, subdir


def inspect_repository(url, revision, route="", tail=""):
    parsed = urlsplit(url)
    scp = re.fullmatch(r"git@[\w.-]+:[\w./-]+", url)
    if not scp and (parsed.scheme not in {"ssh", "https", "http"} or not parsed.hostname
                    or parsed.password or parsed.username and parsed.scheme != "ssh"):
        raise ValueError("请输入 HTTPS 或 SSH Git 地址。")
    if any(c.isspace() for c in url) or revision and (not re.fullmatch(r"[\w./+-]+", revision) or revision.startswith("-")):
        raise ValueError("请核对地址和版本。")
    name = re.split(r"[:/]", url.rstrip("/"))[-1].removesuffix(".git")
    with tempfile.TemporaryDirectory() as temp:
        git(temp, "init", "--bare", "--quiet")
        git(temp, "remote", "add", "origin", url)
        git(temp, "config", "remote.origin.promisor", "true")
        git(temp, "config", "remote.origin.partialclonefilter", "blob:none")
        page_ref, subdir = resolve_page(temp, route, tail) if route else ("HEAD", "")
        revision = revision or page_ref
        prefix = subdir + "/" if subdir else ""
        git(temp, "fetch", "--quiet", "--depth=1", "--filter=blob:none", "--no-tags", "--", "origin", revision)
        sha = git(temp, "rev-parse", "FETCH_HEAD").decode().strip()
        wanted = [prefix + f for f in (*METADATA, *LEGACY)]
        listing = git(temp, "ls-tree", "-rz", sha, "--", *wanted).decode().split("\0")
        paths = {row.split("\t", 1)[1] for row in listing if row.startswith(("100644 ", "100755 "))}
        result = dict(root=subdir.rsplit("/", 1)[-1] or name, revision=revision, subdir=subdir, sha=sha)
        for path in METADATA:
            if prefix + path in paths:
                obj = sha + ":" + prefix + path
                if int(git(temp, "cat-file", "-s", obj)) > LIMIT:
                    raise ValueError("模块描述文件过大。")
                return dict(result, file=path, yaml=git(temp, "show", obj).decode("utf-8-sig"))
        if all(prefix + f in paths for f in LEGACY):
            return dict(result, legacy=True)
        raise ValueError("该版本没有 Zephyr 模块入口。")


class Preview(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if not self.local_host() or (path != "/" and path[1:] not in ASSETS):
            return self.send_error(404)
        if path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_HEAD(self):
        self.send_error(405)

    def local_host(self):
        return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

    def do_POST(self):
        origin = f"http://127.0.0.1:{self.server.server_port}"
        if (not self.local_host() or self.headers.get("Origin") != origin
                or self.headers.get("X-Zephyr-Preview") != "inspect" or self.path not in {"/inspect", "/inspect-repository"}):
            return self.send_error(403)
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= 8192:
                raise ValueError("请求无效。")
            request = json.loads(self.rfile.read(size))
            if request["kind"] == "local":
                result = inspect_directory(request["location"], self.server.workspace)
            elif request["kind"] == "git":
                result = inspect_repository(request["location"], request.get("revision", ""),
                                            request.get("route", ""), request.get("tail", ""))
            else:
                raise ValueError("未知来源。")
            status = 200
        except (ValueError, OSError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
            result, status = {"error": str(error)}, 400
        content = json.dumps(result).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--workspace", type=Path, help="Project root for relative module directories")
    args = parser.parse_args()
    if args.workspace is not None and not args.workspace.is_dir():
        parser.error("--workspace must be an existing directory")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Preview, directory=ROOT))
    server.workspace = args.workspace.resolve() if args.workspace is not None else None
    print(f"http://127.0.0.1:{server.server_port}/index.html", flush=True)
    server.serve_forever()




