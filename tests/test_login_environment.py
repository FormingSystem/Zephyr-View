import importlib.util
import os
import sys
from pathlib import Path
import tempfile
import unittest

file = Path(__file__).resolve().parents[1] / 'extension' / 'register_environment.py'
spec = importlib.util.spec_from_file_location('register_environment', file)
env = importlib.util.module_from_spec(spec)
spec.loader.exec_module(env)


class EnvironmentRegistration(unittest.TestCase):
    def test_parse_quoted_value_and_preserve_foreign_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            name = 'ZEPHYR_BASE'
            file = root / f'80-zephyr-workbench-{name}.conf'
            value = '/路径 with space/$VAR/a"b\\c'
            file.write_text(env.render(name, value), encoding='utf-8')
            self.assertEqual(env.register(dict(name=name), root), value)
            file.write_text('EXISTING=1\n')
            with self.assertRaises(ValueError):
                env.register(dict(name=name), root)
            self.assertEqual(file.read_text(), 'EXISTING=1\n')

    @unittest.skipUnless(os.name == 'posix', 'requires POSIX directory locking')
    def test_atomic_update_refuses_stale_preview(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            key = dict(name='ZEPHYR_BASE', scope='User')
            env.register(dict(key, write=True, value='/sdk', previous=None), root)
            with self.assertRaises(ValueError):
                env.register(dict(key, write=True, value='/stale', previous=None), root)
            self.assertEqual(env.register(key, root), '/sdk')

    @unittest.skipUnless(sys.platform.startswith('linux'), 'requires Linux file permissions')
    def test_user_scope_file_is_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            env.register(dict(name='ZEPHYR_BASE', scope='User', write=True, value='/sdk', previous=None), root)
            self.assertEqual(next(root.iterdir()).stat().st_mode & 0o777, 0o600)
