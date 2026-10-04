"""完整工程打包器的合成自测；不能代替真实飞机、网页或设备验收。"""
from argparse import ArgumentParser
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
import json
import os
import struct
import tempfile
import unittest
import zipfile
import zlib

import package_project as package


def model_bytes():
    data = package.encoded({'asset': {'version': '2.0'},
                            'nodes': [{'mesh': 0}, {'mesh': 0}, {}], 'meshes': [{}]})
    data += b' ' * ((-len(data)) % 4)
    return struct.pack('<4sIIII', b'glTF', 2, 20 + len(data), len(data), 0x4e4f534a) + data


def summary(stages, count):
    return {'modelVersion': package.MODEL_SCHEMA, 'passed': True, 'inputStability': True,
            'inputLockFiles': count, 'stages': [{'name': name, 'exitCode': 0} for name in stages]}


class PackageTests(unittest.TestCase):
    def setUp(self):
        # 合成文件保留在独立系统临时目录，整个自测不调用删除或清理操作。
        self.directory = Path(tempfile.mkdtemp(prefix='transwing-package-selftest-'))
        self.root = self.directory / 'project'
        self.root.mkdir()
        self.output = self.directory / 'complete-project.zip'
        self.files = {name: '仅供合成打包测试\n'.encode() for name in package.MANDATORY}
        self.files.update({
            'package.json': b'{"scripts":{"build":"vite build --emptyOutDir false"}}',
            'package-lock.json': b'{}', 'index.html': b'<html></html>',
            '.gitignore': b'qa/regenerated/\nqa/current/author/*.glb\n',
            'src/App.tsx': b'export const app = 1;', 'src/Scene.tsx': b'export const scene = 1;',
            'qa/frontend/run.py': '# 当前前端检查\n'.encode(),
            'qa/current/check.mts': '// 当前物理检查\n'.encode(),
            'qa/reference/accepted-reference.json': b'{"provenance":"original-model-sha"}',
            'qa/reference/original/support-report.json': b'{"passed":true}',
            'qa/current/author/source-reexport.glb': b'ignored-required-reexport',
            'qa/regenerated/assets/blender/xp4-source.glb': b'ignored-required-rebuilt-source',
            'qa/regenerated/scripts/generate.py': '# 必要重建源\n'.encode(),
            'public/models/manifest.json': b'{"variants":{"xp4":{"file":"xp4.glb"}}}',
            'public/examples/basic.json': b'{"frames":[]}',
            'public/models/xp4.glb': model_bytes(),
            'dist/index.html': b'<link rel="stylesheet" href="./assets/app.css"><script type="module" src="./assets/app.js"></script>',
            'dist/assets/app.js': b'import "./chunk.js";const unused="library-default.jpg";',
            'dist/assets/chunk.js': b'export const value=1;',
            'dist/assets/app.css': b'body{background:url("./shape.svg")}',
            'dist/assets/shape.svg': b'<svg></svg>',
            'dist/assets/old-unreferenced.js': b'old-build-stays-on-disk',
            'assets/blender/old-airplane.blend': b'unrelated-model',
            'qa/current/decoded/scene.json': b'temporary-scene',
            'qa/current/decoded/raw.bin': b'temporary-binary',
            'qa/visual/frames/frame.png': b'temporary-frame',
            'qa/candidates/model.glb': b'unaccepted-candidate',
            'qa/reference/private.png': b'private-photo',
            'qa/reference/old-airplane.glb': b'old-full-aircraft',
            'node_modules/example/index.js': b'installed-dependency',
            '.venv/config.py': b'installed-python', '.env.local': b'token=private',
            'private/model.glb': b'private-file',
        })
        for relative in package.PACKAGING_TOOLS:
            self.files[relative] = (package.ROOT / relative).read_bytes()
        for relative, data in list(self.files.items()):
            if relative.startswith('public/'):
                self.files['dist/' + relative.removeprefix('public/')] = data
        self.stages = ['synthetic-check', 'support-selftest', 'input-stability']
        self.files[package.GEOMETRY_STAGES_PATH] = package.encoded(self.stages)
        self.files[package.STATUS] = ''.join(name + ' 0\n' for name in self.stages).encode()
        for name in self.stages:
            self.files['qa/current/results/' + name + '.log'] = b'passed\n'
            if name not in package.LOG_ONLY_STAGES:
                self.files['qa/current/results/' + name + '-report.json'] = b'{"passed":true}'
        for name in package.FRONTEND_STAGES:
            self.files['qa/frontend/' + name + '.log'] = b'passed\n'
        self.physics_paths = sorted(package.SURFACE_INPUTS | {
            package.GEOMETRY_STAGES_PATH, 'public/models/xp4.glb',
            'assets/blender/xp4-source.glb', 'assets/blender/xp4.blend',
            'qa/current/check.mts', 'qa/current/author/source-reexport.glb',
            'qa/regenerated/assets/blender/xp4-source.glb', 'qa/regenerated/scripts/generate.py',
            'qa/reference/accepted-reference.json', 'qa/reference/original/support-report.json'})
        self.frontend_paths = sorted(package.FRONTEND_FILES | {'src/App.tsx', 'src/Scene.tsx'} | {
            name for name in self.files if name.startswith(('public/', 'dist/'))
            and 'old-unreferenced' not in name})
        self.freeze()
        self.bind_metadata()
        self.files[package.SELFTEST] = package.encoded({
            '全部通过': True, '测试数': 1,
            '脚本SHA256': {name: package.digest(self.files[name]) for name in package.PACKAGING_TOOLS}})
        self.flush()

    def freeze(self):
        for relative, names in [(package.LOCK, self.physics_paths),
                                (package.FRONTEND_LOCK, self.frontend_paths)]:
            self.files[relative] = package.encoded({'files': [
                {'path': name, 'sha256': package.digest(self.files[name])} for name in names]})
        data = summary(self.stages, len(self.physics_paths))
        for key, relative in [('runtimeSha256', 'public/models/xp4.glb'),
                              ('sourceSha256', 'assets/blender/xp4-source.glb'),
                              ('sourceBlendSha256', 'assets/blender/xp4.blend')]:
            data[key] = package.digest(self.files[relative])
        self.files[package.SUMMARY] = package.encoded(data)
        distribution = [name for name in self.frontend_paths if name.startswith('dist/')]
        self.files[package.BUILD_PRESERVATION] = package.encoded({
            'passed': True, 'removedPaths': [], 'currentDistributionFiles': distribution,
            'retainedHistoricalPaths': ['dist/assets/old-unreferenced.js']})
        data = summary(package.FRONTEND_STAGES, len(self.frontend_paths))
        data.update({'nonDeletingBuild': True, 'buildPreservationPath': package.BUILD_PRESERVATION,
                     'buildPreservationSha256': package.digest(self.files[package.BUILD_PRESERVATION]),
                     'currentDistributionFiles': len(distribution), 'changedInputs': [],
                     'distributionError': None,
                     'runtimeSha256': package.digest(self.files['public/models/xp4.glb'])})
        self.files[package.FRONTEND_SUMMARY] = package.encoded(data)

    def bind_metadata(self):
        data = {'项目名称': '完整工程合成测试', '参考构型数量': 1,
                '合并冻结输入数': len(set(self.physics_paths) | set(self.frontend_paths)),
                **package.glb_counts(self.files['public/models/xp4.glb'])}
        for label, relative in [('网页模型', 'public/models/xp4.glb'),
                                ('独立模型', 'assets/blender/xp4-source.glb'),
                                ('Blender源', 'assets/blender/xp4.blend')]:
            data[label + 'SHA256'] = package.digest(self.files[relative])
            data[label + '字节数'] = len(self.files[relative])
        for key, relative in [('概念模块SHA256', 'public/models/nacelle-system-concept.glb'),
                              ('概念模块源SHA256', 'assets/blender/nacelle-system-concept-source.glb'),
                              ('模型清单SHA256', 'public/models/manifest.json')]:
            data[key] = package.digest(self.files[relative])
        for label, report, lock in [('最终验收', package.SUMMARY, package.LOCK),
                                   ('前端验收', package.FRONTEND_SUMMARY, package.FRONTEND_LOCK)]:
            data[label] = {'全部通过': True, '输入稳定': True, '路径': report,
                           '输入锁路径': lock, 'SHA256': package.digest(self.files[report]),
                           '输入锁SHA256': package.digest(self.files[lock]),
                           '阶段数': len(json.loads(self.files[report])['stages']),
                           '冻结输入数': len(json.loads(self.files[lock])['files'])}
        self.files[package.METADATA] = package.encoded(data)

    def flush(self):
        for relative, data in self.files.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

    def write_json(self, relative, data):
        (self.root / relative).write_bytes(package.encoded(data))

    def make_package(self, overwrite=False):
        return package.write_package(self.root, self.output, overwrite=overwrite)

    def archive_contents(self):
        with zipfile.ZipFile(self.output) as archive:
            self.assertIsNone(archive.testzip())
            return {name.removeprefix(package.PREFIX): archive.read(name) for name in archive.namelist()}

    def test_reject_noncanonical_paths(self):
        for name in ['', '../a', '/a', 'a//b', 'a/./b', 'a\\b', 'C:a', 'a\nb',
                     'a\x7fb', 'a/CON.txt', 'a/end.', 'a/end ', 'a/what?.json']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                package.safe_relative(name)

    def test_forbidden_paths_cannot_be_locked(self):
        for name in ['node_modules/a.js', '.venv/a', '.git/config', 'a/.env.local',
                     'qa/reference/private.png', 'qa/reference/old.glb', 'private/model.glb',
                     'a/key.pem', '.npmrc', 'a/credentials.json', 'a/secret.json',
                     'qa/candidates/model.glb', 'qa/current/decoded/scene.json',
                     'qa/v99/report.json', 'qa/candidate-mesh/a.json']:
            with self.subTest(name=name):
                self.assertTrue(package.forbidden(name))
                with self.assertRaises(ValueError):
                    package.locked_inputs(package.encoded({'files': [{'path': name, 'sha256': 'a' * 64}]}))
        self.assertFalse(package.forbidden('qa/reference/accepted-reference.json'))
        self.assertFalse(package.forbidden('scripts/data/preserved-front-surfaces.blend'))

    def test_duplicate_and_invalid_locks(self):
        row = {'path': 'a.py', 'sha256': 'a' * 64}
        for rows in [[], [row, row], [{'path': 'a.py', 'sha256': 'bad'}], [None]]:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                package.locked_inputs(package.encoded({'files': rows}))

    def test_input_symlinks_and_parent_symlinks_rejected(self):
        (self.root / 'link').symlink_to(self.root / 'README.md')
        (self.root / 'linked').symlink_to(self.root / 'src', target_is_directory=True)
        for name in ['link', 'linked/App.tsx']:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, '符号链接'):
                package.input_path(name, self.root)

    def test_selected_symlink_rejected(self):
        (self.root / 'src/link.ts').symlink_to(self.root / 'src/App.tsx')
        with self.assertRaisesRegex(ValueError, '符号链接'):
            self.make_package()

    def test_excluded_dependency_symlinks_do_not_raise(self):
        dependency = self.directory / 'installed-dependency'
        dependency.mkdir()
        (dependency / 'index.js').write_bytes(b'local-installed-dependency')
        (self.root / 'scripts/node_modules').symlink_to(dependency, target_is_directory=True)
        (self.root / 'scripts/.venv').symlink_to(dependency, target_is_directory=True)
        self.make_package()
        names = self.archive_contents()
        self.assertFalse(any('node_modules' in name or '.venv' in name for name in names))

    def test_stages_reject_empty_duplicate_or_invalid_names(self):
        for value in [[], ['same', 'same'], ['valid', None], ['../escape'], 'name']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                package.stage_names(package.encoded(value))

    def test_summary_rejects_stale_failed_unstable_bad_count_and_order(self):
        valid = summary(package.FRONTEND_STAGES, 5)
        changes = [dict(passed=False), dict(inputStability=False), dict(modelVersion=23),
                   dict(inputLockFiles=4), dict(inputLockFiles=True), dict(changedInputs=['src/App.tsx']),
                   dict(distributionError='missing')]
        for fields in changes:
            value = deepcopy(valid)
            value.update(fields)
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                package.validate_summary(package.encoded(value), package.FRONTEND_STAGES, 5, '合成')
        for kind in ['missing', 'duplicate', 'reversed', 'failure', 'boolean']:
            value = deepcopy(valid)
            if kind == 'missing':
                value['stages'].pop()
            elif kind == 'duplicate':
                value['stages'][1] = value['stages'][0]
            elif kind == 'reversed':
                value['stages'].reverse()
            else:
                value['stages'][0]['exitCode'] = False if kind == 'boolean' else 1
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                package.validate_summary(package.encoded(value), package.FRONTEND_STAGES, 5, '合成')

    def test_complete_roundtrip_and_union_includes_ignored_inputs(self):
        result = self.make_package()
        contents = self.archive_contents()
        union = set(self.physics_paths) | set(self.frontend_paths)
        self.assertTrue(union <= set(contents))
        self.assertTrue(package.MANDATORY <= set(contents))
        self.assertEqual(result['combinedLockedInputs'], len(union))
        self.assertEqual(result['bytes'], self.output.stat().st_size)
        self.assertEqual(result['sha256'], package.digest(self.output.read_bytes()))
        for name in union:
            self.assertEqual(contents[name], self.files[name])

    def test_current_visual_root_files_included_without_frontend_lock(self):
        current = {
            'qa/visual/current-model.png': b'current-model-image',
            'qa/visual/current-motion.mp4': b'current-model-video',
            'qa/visual/render.py': '# 当前模型渲染脚本\n'.encode(),
            'qa/visual/inspect.mjs': '// 当前模型像素检查\n'.encode(),
            'qa/visual/report.json': b'{"passed":true}',
            'qa/visual/README.md': '# 当前模型成片说明\n'.encode(),
        }
        self.files.update(current)
        self.flush()
        self.make_package()
        contents = self.archive_contents()
        for name, data in current.items():
            with self.subTest(name=name):
                self.assertTrue(package.selected(name))
                self.assertEqual(contents[name], data)
        frontend_paths = {row['path'] for row in json.loads(contents[package.FRONTEND_LOCK])['files']}
        self.assertTrue(set(current).isdisjoint(frontend_paths))

    def test_nested_private_and_old_visual_files_excluded(self):
        excluded = {
            'qa/visual/frames/frame.png': b'temporary-frame',
            'qa/visual/scenes/model.json': b'temporary-scene',
            'qa/visual/preparation/preview.png': b'preparation-preview',
            'qa/visual/preparation/render.py': b'preparation-script',
            'qa/visual/private/original.png': b'private-reference',
            'qa/visual/reference/original.jpg': b'private-reference',
            'qa/visual/model-v23.png': b'old-model-image',
            'qa/visual/V23-comparison.mp4': b'old-comparison-video',
            'qa/visual/current-model.blend': b'temporary-render-scene',
        }
        self.files.update(excluded)
        self.flush()
        self.make_package()
        contents = self.archive_contents()
        for name, data in excluded.items():
            with self.subTest(name=name):
                self.assertFalse(package.selected(name))
                self.assertNotIn(name, contents)
                self.assertEqual((self.root / name).read_bytes(), data)

    def test_excluded_files_stay_on_disk_and_outside_zip(self):
        excluded = ['dist/assets/old-unreferenced.js', 'assets/blender/old-airplane.blend',
                    'qa/current/decoded/scene.json', 'qa/current/decoded/raw.bin',
                    'qa/visual/frames/frame.png', 'qa/candidates/model.glb',
                    'qa/reference/private.png', 'qa/reference/old-airplane.glb',
                    'node_modules/example/index.js', '.venv/config.py', '.env.local', 'private/model.glb']
        before = {name: (self.root / name).read_bytes() for name in excluded}
        self.make_package()
        contents = self.archive_contents()
        for name in excluded:
            self.assertNotIn(name, contents)
            self.assertEqual((self.root / name).read_bytes(), before[name])

    def test_manifest_binds_every_file_crc_sha_size_and_tools(self):
        self.make_package()
        contents = self.archive_contents()
        manifest = json.loads(contents[package.MANIFEST])
        self.assertEqual({row['path'] for row in manifest['files']}, set(contents) - {package.MANIFEST})
        for row in manifest['files']:
            self.assertEqual(row['bytes'], len(contents[row['path']]))
            self.assertEqual(row['sha256'], package.digest(contents[row['path']]))
            self.assertEqual(row['crc32'], f'{zlib.crc32(contents[row["path"]]):08x}')
        self.assertEqual(manifest['packagingTools'], {
            name: package.digest(contents[name]) for name in package.PACKAGING_TOOLS})
        self.assertEqual(manifest['packagingSelftestSha256'], package.digest(contents[package.SELFTEST]))

    def test_packaging_is_deterministic(self):
        payload1, manifest1, result1 = package.prepare_package(self.root)
        payload2, manifest2, result2 = package.prepare_package(self.root)
        self.assertEqual((payload1, manifest1, result1), (payload2, manifest2, result2))

    def test_stale_locked_input_rejected_before_output(self):
        (self.root / 'src/App.tsx').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, '冻结输入已变化'):
            self.make_package()
        self.assertFalse(self.output.exists())

    def test_conflicting_locks_rejected(self):
        lock = json.loads(self.files[package.FRONTEND_LOCK])
        for row in lock['files']:
            if row['path'] == 'public/models/xp4.glb':
                row['sha256'] = '1' * 64
        self.write_json(package.FRONTEND_LOCK, lock)
        with self.assertRaisesRegex(ValueError, '互相冲突'):
            self.make_package()

    def test_missing_locked_ignored_file_rejected(self):
        lock = json.loads(self.files[package.LOCK])
        lock['files'][0]['path'] = 'qa/regenerated/missing.glb'
        self.write_json(package.LOCK, lock)
        with self.assertRaises(ValueError):
            self.make_package()
        self.assertFalse(self.output.exists())

    def test_surface_templates_must_be_in_physics_lock(self):
        lock = json.loads(self.files[package.LOCK])
        lock['files'] = [row for row in lock['files'] if row['path'] not in package.SURFACE_INPUTS]
        self.write_json(package.LOCK, lock)
        with self.assertRaisesRegex(ValueError, '必要蒙皮模板'):
            self.make_package()

    def test_stage_contract_must_be_locked(self):
        lock = json.loads(self.files[package.LOCK])
        lock['files'] = [row for row in lock['files'] if row['path'] != package.GEOMETRY_STAGES_PATH]
        self.write_json(package.LOCK, lock)
        with self.assertRaisesRegex(ValueError, '阶段约定'):
            self.make_package()

    def test_packaging_tools_cannot_enter_frontend_lock(self):
        lock = json.loads(self.files[package.FRONTEND_LOCK])
        name = package.PACKAGING_TOOLS[0]
        lock['files'].append({'path': name, 'sha256': package.digest(self.files[name])})
        self.write_json(package.FRONTEND_LOCK, lock)
        with self.assertRaisesRegex(ValueError, '单独绑定'):
            self.make_package()

    def test_frontend_lock_cannot_omit_actual_source(self):
        self.frontend_paths.remove('src/Scene.tsx')
        self.freeze()
        self.bind_metadata()
        self.flush()
        with self.assertRaisesRegex(ValueError, '未覆盖实际应用输入'):
            self.make_package()

    def test_frontend_coverage_does_not_depend_on_file_suffix(self):
        (self.root / 'src/required.fixture').write_bytes(b'required-source-fixture')
        with self.assertRaisesRegex(ValueError, '未覆盖实际应用输入'):
            self.make_package()

    def test_frontend_coverage_follows_external_relative_dependency(self):
        self.files['scripts/runtime-helper.mts'] = b'export const helper = 1;'
        self.files['src/App.tsx'] += b'import "../scripts/runtime-helper.mts";'
        self.freeze()
        self.bind_metadata()
        self.flush()
        with self.assertRaisesRegex(ValueError, '未覆盖实际应用输入.*runtime-helper'):
            self.make_package()

    def test_frontend_cache_files_are_excluded(self):
        cached = self.root / 'src/__pycache__'
        cached.mkdir()
        (cached / 'cached.pyc').write_bytes(b'cache')
        (self.root / 'src/cached.pyo').write_bytes(b'cache')
        self.make_package()
        self.assertFalse(any('__pycache__' in name or name.endswith('.pyo')
                             for name in self.archive_contents()))

    def test_mandatory_raw_concept_is_included_without_git(self):
        self.make_package()
        contents = self.archive_contents()
        name = 'assets/blender/nacelle-system-concept-source.glb'
        self.assertEqual(contents[name], self.files[name])
        self.assertFalse((self.root / '.git').exists())

    def test_failed_physics_report_rejected(self):
        self.write_json('qa/current/results/synthetic-check-report.json', {'passed': False})
        with self.assertRaisesRegex(ValueError, '原始报告未通过'):
            self.make_package()

    def test_status_log_order_rejected(self):
        (self.root / package.STATUS).write_bytes(b'support-selftest 0\nsynthetic-check 0\ninput-stability 0\n')
        with self.assertRaisesRegex(ValueError, '阶段记录'):
            self.make_package()

    def test_absent_stage_log_rejected(self):
        # 模拟文件系统缺少日志；原合成文件保持原名与原字节，不移动或删除。
        original = package.input_path

        def missing(relative, root):
            if relative == 'qa/frontend/unit.log':
                raise ValueError('工程输入缺失：' + relative)
            return original(relative, root)

        with patch.object(package, 'input_path', side_effect=missing):
            with self.assertRaisesRegex(ValueError, '输入缺失'):
                self.make_package()

    def test_physics_runtime_binding_rejected(self):
        data = json.loads(self.files[package.SUMMARY])
        data['runtimeSha256'] = '0' * 64
        self.write_json(package.SUMMARY, data)
        with self.assertRaisesRegex(ValueError, '物理汇总模型哈希'):
            self.make_package()

    def test_frontend_runtime_binding_rejected(self):
        data = json.loads(self.files[package.FRONTEND_SUMMARY])
        data['runtimeSha256'] = '0' * 64
        self.write_json(package.FRONTEND_SUMMARY, data)
        with self.assertRaisesRegex(ValueError, '前端汇总运行模型哈希'):
            self.make_package()

    def test_stale_public_dist_bytes_rejected(self):
        self.files['dist/models/manifest.json'] = b'{"stale":true}'
        self.freeze()
        self.bind_metadata()
        self.flush()
        with self.assertRaisesRegex(ValueError, '字节不一致'):
            self.make_package()

    def test_non_deleting_flag_required(self):
        data = json.loads(self.files[package.FRONTEND_SUMMARY])
        data['nonDeletingBuild'] = False
        self.write_json(package.FRONTEND_SUMMARY, data)
        with self.assertRaisesRegex(ValueError, '非删除式'):
            self.make_package()

    def test_preservation_report_hash_required(self):
        data = json.loads(self.files[package.FRONTEND_SUMMARY])
        data['buildPreservationSha256'] = '0' * 64
        self.write_json(package.FRONTEND_SUMMARY, data)
        with self.assertRaisesRegex(ValueError, '非删除式'):
            self.make_package()

    def test_preservation_removed_paths_rejected(self):
        data = json.loads(self.files[package.BUILD_PRESERVATION])
        data['removedPaths'] = ['dist/assets/old-unreferenced.js']
        self.write_json(package.BUILD_PRESERVATION, data)
        with self.assertRaisesRegex(ValueError, '非删除式'):
            self.make_package()

    def test_preservation_dist_set_must_match_lock(self):
        data = json.loads(self.files[package.BUILD_PRESERVATION])
        data['currentDistributionFiles'].pop()
        self.files[package.BUILD_PRESERVATION] = package.encoded(data)
        frontend = json.loads(self.files[package.FRONTEND_SUMMARY])
        frontend['buildPreservationSha256'] = package.digest(self.files[package.BUILD_PRESERVATION])
        self.files[package.FRONTEND_SUMMARY] = package.encoded(frontend)
        self.flush()
        with self.assertRaisesRegex(ValueError, '构建闭包与冻结输入'):
            self.make_package()

    def test_missing_js_dependency_rejected(self):
        self.files['dist/assets/app.js'] += b'import "./missing.js";'
        self.freeze()
        self.bind_metadata()
        self.flush()
        with self.assertRaisesRegex(ValueError, '引用缺失'):
            self.make_package()

    def test_missing_css_dependency_rejected(self):
        self.files['dist/assets/app.css'] += b'body{src:url(./missing.woff2)}'
        self.freeze()
        self.bind_metadata()
        self.flush()
        with self.assertRaisesRegex(ValueError, '引用缺失'):
            self.make_package()

    def test_unreferenced_build_cannot_be_smuggled_into_lock(self):
        self.frontend_paths.append('dist/assets/old-unreferenced.js')
        self.freeze()
        self.bind_metadata()
        self.flush()
        with self.assertRaisesRegex(ValueError, '构建引用闭包'):
            self.make_package()

    def test_distribution_path_escape_rejected(self):
        self.files['dist/assets/app.js'] += b'import "../../../outside.js";'
        self.freeze()
        self.bind_metadata()
        self.flush()
        with self.assertRaisesRegex(ValueError, '回退段|超出dist'):
            self.make_package()

    def test_project_metadata_placeholder_rejected(self):
        data = json.loads(self.files[package.METADATA])
        data['网页模型SHA256'] = None
        self.write_json(package.METADATA, data)
        with self.assertRaisesRegex(ValueError, '未冻结'):
            self.make_package()

    def test_project_metadata_summary_hash_rejected(self):
        data = json.loads(self.files[package.METADATA])
        data['最终验收']['SHA256'] = '0' * 64
        self.write_json(package.METADATA, data)
        with self.assertRaisesRegex(ValueError, '最终通过汇总'):
            self.make_package()

    def test_project_metadata_glb_counts_rejected(self):
        data = json.loads(self.files[package.METADATA])
        data['实际网格数'] += 1
        self.write_json(package.METADATA, data)
        with self.assertRaisesRegex(ValueError, '模型计数'):
            self.make_package()

    def test_glb_headers_rejected(self):
        for data in [b'bad', b'\0' * 100, model_bytes()[:-1]]:
            with self.subTest(data=data[:10]), self.assertRaises(ValueError):
                package.glb_counts(data)

    def test_selftest_hash_changes_rejected(self):
        name = package.PACKAGING_TOOLS[0]
        (self.root / name).write_bytes('# 自测后发生改动\n'.encode())
        with self.assertRaisesRegex(ValueError, '自测'):
            self.make_package()

    def test_selftest_must_pass(self):
        data = json.loads(self.files[package.SELFTEST])
        data['全部通过'] = False
        self.write_json(package.SELFTEST, data)
        with self.assertRaisesRegex(ValueError, '自测'):
            self.make_package()

    def test_archive_tamper_rejected(self):
        payload, manifest, _ = package.prepare_package(self.root)
        stream = BytesIO()
        with zipfile.ZipFile(BytesIO(payload)) as original, zipfile.ZipFile(stream, 'w') as changed:
            for info in original.infolist():
                data = b'corrupted' if info.filename.endswith('src/App.tsx') else original.read(info.filename)
                changed.writestr(info, data)
        with self.assertRaisesRegex(ValueError, '包内文件'):
            package.validate_archive(stream.getvalue(), manifest)

    def test_archive_unexpected_file_rejected(self):
        payload, manifest, _ = package.prepare_package(self.root)
        stream = BytesIO(payload)
        with zipfile.ZipFile(stream, 'a') as archive:
            archive.writestr(package.PREFIX + 'extra.txt', b'extra')
        with self.assertRaisesRegex(ValueError, '文件集合'):
            package.validate_archive(stream.getvalue(), manifest)

    def test_archive_manifest_tamper_rejected(self):
        payload, manifest, _ = package.prepare_package(self.root)
        stream = BytesIO()
        with zipfile.ZipFile(BytesIO(payload)) as original, zipfile.ZipFile(stream, 'w') as changed:
            for info in original.infolist():
                data = b'{}' if info.filename.endswith(package.MANIFEST) else original.read(info.filename)
                changed.writestr(info, data)
        with self.assertRaisesRegex(ValueError, '包内文件|清单字节'):
            package.validate_archive(stream.getvalue(), manifest)

    def test_case_collisions_rejected(self):
        (self.root / 'src/app.tsx').write_bytes(b'case-collision')
        with self.assertRaisesRegex(ValueError, '等价冲突'):
            self.make_package()

    def test_output_inside_project_rejected(self):
        with self.assertRaisesRegex(ValueError, '工程目录外'):
            package.write_package(self.root, self.root / 'project.zip')

    def test_output_symlink_rejected(self):
        existing = self.directory / 'existing.zip'
        existing.write_bytes(b'preserve')
        self.output.symlink_to(existing)
        with self.assertRaisesRegex(ValueError, '符号链接'):
            self.make_package(overwrite=True)
        self.assertEqual(existing.read_bytes(), b'preserve')

    def test_existing_output_needs_explicit_overwrite(self):
        self.output.write_bytes(b'existing-output')
        with self.assertRaisesRegex(ValueError, '--overwrite'):
            self.make_package()
        self.assertEqual(self.output.read_bytes(), b'existing-output')
        self.make_package(overwrite=True)
        self.assertTrue(zipfile.is_zipfile(self.output))

    def test_failed_validation_preserves_existing_output(self):
        self.output.write_bytes(b'existing-output')
        (self.root / 'src/App.tsx').write_bytes(b'stale')
        with self.assertRaises(ValueError):
            self.make_package(overwrite=True)
        self.assertEqual(self.output.read_bytes(), b'existing-output')

    def test_drift_during_compression_rejected(self):
        original = package.validate_archive

        def drift(payload, manifest):
            result = original(payload, manifest)
            (self.root / 'README.md').write_bytes(b'changed-during-compression')
            return result

        with patch.object(package, 'validate_archive', side_effect=drift):
            with self.assertRaisesRegex(ValueError, '打包期间输入已变化'):
                self.make_package()
        self.assertFalse(self.output.exists())

    def test_executable_mode_preserved(self):
        os.chmod(self.root / 'qa/frontend/run.py', 0o755)
        self.make_package()
        with zipfile.ZipFile(self.output) as archive:
            info = archive.getinfo(package.PREFIX + 'qa/frontend/run.py')
            self.assertEqual((info.external_attr >> 16) & 0o777, 0o755)

    def test_single_package_over_twenty_mib_keeps_all_dependencies(self):
        # 不可压缩的合成运行资源及其静态副本使单包超过旧大小门槛。
        data = os.urandom(11 * 1024 * 1024)
        for name in ['public/models/large-required.bin', 'dist/models/large-required.bin']:
            self.files[name] = data
            self.frontend_paths.append(name)
        self.freeze()
        self.bind_metadata()
        self.flush()
        result = self.make_package()
        self.assertGreater(result['bytes'], 20 * 1024 * 1024)
        contents = self.archive_contents()
        self.assertEqual(contents['public/models/large-required.bin'], data)
        self.assertEqual(contents['dist/models/large-required.bin'], data)
        self.assertEqual(list(self.directory.glob('*.zip')), [self.output])


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, help='写入中文合成自测报告，绑定当前两份打包脚本')
    args = parser.parse_args()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PackageTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    report = {
        '全部通过': result.wasSuccessful(), '测试数': result.testsRun,
        '失败数': len(result.failures), '异常数': len(result.errors),
        '说明': '只验证合成工程的打包、安全、冻结依赖、阶段证据、单包完整性和非删除写入逻辑；不代表真实模型、前端、浏览器或设备验收通过。合成临时目录保留，不删除任何目录或文件。',
        '脚本SHA256': {name: package.digest((package.ROOT / name).read_bytes())
                       for name in package.PACKAGING_TOOLS},
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_bytes(package.encoded(report))
        if json.loads(args.report.read_bytes()) != report:
            raise ValueError('自测报告落盘核验失败')
    raise SystemExit(0 if result.wasSuccessful() else 1)


if __name__ == '__main__':
    main()
