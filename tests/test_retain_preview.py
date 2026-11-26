import runpy
import unittest
from pathlib import Path


script = Path(__file__).resolve().parents[1] / "tools/retain_preview.py"
superseded = runpy.run_path(str(script))["superseded"]


def preview(identifier, tag, **changes):
    return {"id": identifier, "tag_name": tag, "prerelease": True, "draft": False,
            "published_at": "2026-01-01T00:00:00Z", **changes}


class PreviewRetentionTest(unittest.TestCase):
    def test_only_superseded_public_versions_are_removed(self):
        prior = preview(1, "v0.5.9")
        current = preview(2, "v0.5.10")
        self.assertEqual(superseded([preview(3, "v0.6.0", draft=True), prior, current,
                                     preview(0, "experiment")], current), [prior])

    def test_stale_event_or_stable_release_disables_cleanup(self):
        prior = preview(1, "v0.5.9")
        current = preview(2, "v0.5.10")
        self.assertEqual(superseded([prior], current), [])
        for other in (preview(3, "v0.5.11"), preview(0, "v0.4.0", prerelease=False)):
            self.assertEqual(superseded([prior, current, other], current), [])
