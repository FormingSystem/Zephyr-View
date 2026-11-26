"""Download the published VSIX identified by the release event and verify its contents."""
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from zipfile import ZipFile


def git_commit(ref):
    return subprocess.check_output(["git", "rev-parse", ref + "^{commit}"], text=True).strip()


def release_asset(event, manifest):
    release = event["release"]
    version = manifest["version"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?", version):
        raise ValueError("Invalid package version")
    tag = "v" + version
    if event["action"] != "published" or release["draft"] or release["tag_name"] != tag:
        raise ValueError("A published release matching the extension version is required")
    if git_commit("HEAD") != os.environ["GITHUB_SHA"] or git_commit("refs/tags/" + tag) != os.environ["GITHUB_SHA"]:
        raise ValueError("Release tag and checkout must both match the triggering commit")
    archive = "zephyr-extension-" + version + ".vsix"
    matches = [asset for asset in release["assets"] if asset["name"] == archive and asset["state"] == "uploaded"]
    if len(matches) != 1:
        raise ValueError(f"The published release must have exactly one uploaded {archive}")
    return matches[0]


def main():
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    manifest = json.loads(Path("extension/package.json").read_text(encoding="utf-8"))
    asset = release_asset(event, manifest)
    repository = os.environ["GITHUB_REPOSITORY"]
    endpoint = f"repos/{repository}/releases/assets/{int(asset['id'])}"
    metadata = json.loads(subprocess.check_output(["gh", "api", endpoint]))
    digest = metadata.get("digest") or ""
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest) or asset.get("digest", digest) != digest:
        raise ValueError("Published asset must have a matching GitHub SHA-256 digest")
    archive = Path(asset["name"])
    with archive.open("wb") as output:
        subprocess.run(["gh", "api", "-H", "Accept: application/octet-stream", endpoint], stdout=output, check=True)
    if archive.stat().st_size != asset["size"] or "sha256:" + hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
        raise ValueError("Downloaded release asset differs from its published size or digest")
    with ZipFile(archive) as package:
        embedded = json.loads(package.read("extension/package.json"))
    if any(embedded.get(key) != manifest[key] for key in ("name", "publisher", "version")):
        raise ValueError("Packaged extension identity or version differs from the checkout")
    receipt = {"assetId": asset["id"], "digest": digest, "size": asset["size"], "tag": event["release"]["tag_name"],
               "sha": os.environ["GITHUB_SHA"], "releaseId": event["release"]["id"], "name": archive.name}
    Path("verified-release-vsix.json").write_text(json.dumps(receipt) + "\n", encoding="utf-8")
    with Path(os.environ["GITHUB_ENV"]).open("a", encoding="utf-8") as output:
        output.write("NATIVE_TEST_VSIX=" + archive.name + "\n")
    print(f"Verified {archive.name} ({digest})")


if __name__ == "__main__":
    main()
