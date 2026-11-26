"""Retire older development previews after native checks verify the new VSIX."""
import json
import os
import re
import subprocess
from pathlib import Path


def version(tag):
    if re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag):
        return tuple(map(int, tag[1:].split(".")))


def superseded(releases, verified):
    public = [release for release in releases if not release["draft"]]
    current = next((r for r in public if r["id"] == verified["id"]), None)
    if not current or not current["prerelease"] or current["tag_name"] != verified["tag_name"]:
        return []
    # A stable release ends the single-preview phase. An older run must leave
    # the previous download available while a newer preview is being tested.
    newest = max(public, key=lambda r: (r["published_at"], r["id"]))
    if newest != current or any(not r["prerelease"] for r in public):
        return []
    keep = version(current["tag_name"])
    return [r for r in public if keep and (old := version(r["tag_name"])) and old < keep]


def main():
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    if event.get("action") != "published" or not event["release"]["prerelease"]:
        return
    repo = "repos/" + os.environ["GITHUB_REPOSITORY"]

    def pages(endpoint):
        data = subprocess.check_output(["gh", "api", "--paginate", "--slurp",
                                        f"{repo}/{endpoint}?per_page=100"])
        return [item for page in json.loads(data) for item in page]

    def delete(endpoint):
        subprocess.run(["gh", "api", "--method", "DELETE", f"{repo}/{endpoint}"], check=True)

    older = superseded(pages("releases"), event["release"])
    if not older:
        return
    tags = {t["name"] for t in pages("tags")}
    for release in older:
        tag = release["tag_name"]
        # Keep the release record until its tag is gone so retries can finish.
        if tag in tags:
            delete(f"git/refs/tags/{tag}")
        delete(f"releases/{release['id']}")
        print(f"Retired {tag}")


if __name__ == "__main__":
    main()
