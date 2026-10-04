"""在内存中核验并生成一个完整当前工程包；不删除源码、旧构建或旧交付。"""
from argparse import ArgumentParser
from collections import Counter
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit
import hashlib
import json
import os
import posixpath
import re
import stat
import struct
import unicodedata
import zipfile
import zlib


ROOT = Path(__file__).resolve().parent.parent
MODEL_SCHEMA = 24
PREFIX = 'transwing-studio/'
LOCK = 'qa/current/results/input-lock.json'
SUMMARY = 'qa/current/results/summary.json'
GEOMETRY_STAGES_PATH = 'qa/current/stages.json'
STATUS = 'qa/current/results/status.log'
SUPPLEMENT_DIR = 'qa/current/host-protection-supplement'
SUPPLEMENT_LOCK = SUPPLEMENT_DIR + '/input-lock.json'
SUPPLEMENT_SUMMARY = SUPPLEMENT_DIR + '/summary.json'
ORIGINAL_INPUT_DIR = 'qa/current/full-chain-original-inputs'
ORIGINAL_OVERLAY = ORIGINAL_INPUT_DIR + '/OVERLAY.json'
HARDENED_INPUTS = {
    'qa/current/summarize.mjs', 'qa/nacelle/host-decoration-preservation.mts',
    'qa/nacelle/powertrain-identity.selftest.mts', 'qa/reference/code-migration.json'}
SUPPLEMENT_STAGES = ['powertrain-identity-selftest', 'nacelle-placement',
                     'indexed-host-material', 'unused-points-regression', 'input-stability']
SUPPLEMENT_DEPENDENCIES = {
    'qa/current/verify-host-hardening-supplement.mjs',
    'qa/current/run-host-hardening-supplement.sh',
    'qa/nacelle/audit-host-indexed-exactness.mts',
    'qa/nacelle/host-unused-points-regression.mts',
    'qa/nacelle/host-indexed-exactness.mjs',
    'qa/nacelle/host-indexed-exactness.selftest.mjs',
    'qa/nacelle/verify-nacelle-placement.mts'}
FRONTEND_LOCK = 'qa/frontend/input-lock.json'
FRONTEND_SUMMARY = 'qa/frontend/summary.json'
BUILD_PRESERVATION = 'qa/frontend/build-preservation.json'
FRONTEND_STAGES = ['unit', 'flight-loader', 'format', 'build', 'python']
FRONTEND_ROOTS = ['src', 'python/transwing_sim', 'python/tests', 'public', 'examples/python']
FRONTEND_FILES = {'package.json', 'package-lock.json', 'index.html', 'vite.config.ts',
                  'tsconfig.json', 'qa/flight-regression.test.ts', 'qa/glb-loader-check.mjs',
                  'qa/frontend/run.py'}
FRONTEND_CODE_SUFFIXES = {'.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx'}
LOG_ONLY_STAGES = {'support-selftest', 'triangle-selftest', 'solid-selftest', 'input-stability'}
MANIFEST = 'PROJECT_MANIFEST.json'
METADATA = '项目信息.json'
SELFTEST = 'docs/PACKAGING_SELFTEST.json'
PACKAGING_TOOLS = ['scripts/package_project.py', 'scripts/test_package_project.py']
SURFACE_INPUTS = {'scripts/data/preserved-front-surfaces.blend',
                  'scripts/data/preserved-front-surfaces.json'}
VERSIONED_REFERENCE_INPUTS = {'qa/reference/nacelle-oriented-repair-corrections-v2.json'}
CORE_MODELS = {'assets/blender/xp4.blend', 'assets/blender/xp4-source.glb',
               'assets/blender/nacelle-system-concept-source.glb',
               'public/models/xp4.glb', 'public/models/nacelle-system-concept.glb',
               'dist/models/xp4.glb', 'dist/models/nacelle-system-concept.glb'}
DOCUMENTS = {'README.md', '下载说明.txt'} | {
    'docs/' + name + '.md' for name in
    ['PROJECT', 'MECHANISM', 'ASSETS', 'VERIFICATION', 'PYTHON_API', 'NAVIGATION', 'DELIVERY']}
MANDATORY = DOCUMENTS | CORE_MODELS | SURFACE_INPUTS | FRONTEND_FILES | set(PACKAGING_TOOLS) | {
    'package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json',
    'src/App.tsx', 'src/Scene.tsx', 'dist/index.html', 'THIRD_PARTY_NOTICES.txt',
    'python/install.py', 'python/run_server.py', 'python/requirements.lock',
    'python/protocol.schema.json', 'scripts/package.json', 'scripts/package-lock.json',
    'public/models/manifest.json', 'dist/models/manifest.json', METADATA, SELFTEST,
    LOCK, SUMMARY, FRONTEND_LOCK, FRONTEND_SUMMARY, BUILD_PRESERVATION,
    GEOMETRY_STAGES_PATH, STATUS}
FORBIDDEN_PARTS = {
    '.git', '.venv', 'venv', 'node_modules', '__pycache__', '.sites-runtime',
    '.aws', '.ssh', '.codex', '.agents', 'private', 'secrets', 'credentials',
    'input-images', 'private-reference', 'reference-private', 'original-photo',
    'candidates', 'candidate', 'diagnostics', 'diagnostic', 'probes', 'probe',
    'preflight', 'frames', 'scenes', 'temporary-scenes', 'decoded', 'tmp', 'temp',
}
MEDIA_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.tif', '.tiff',
                  '.bmp', '.mp4', '.webm', '.mov', '.avi', '.pdf'}
SOURCE_SUFFIXES = {'.py', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
                   '.json', '.md', '.txt', '.sh', '.css', '.html', '.toml', '.ini', '.csv', '.lock'}
ASSET_SUFFIXES = {'.html', '.js', '.mjs', '.css', '.json', '.wasm', '.svg', '.png',
                  '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf',
                  '.otf', '.glb', '.gltf', '.bin', '.mp4', '.webm'}


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_relative(relative):
    """拒绝跨平台歧义、回退、控制字符与不可移植的文件名。"""
    if not isinstance(relative, str) or not relative or '\\' in relative or ':' in relative:
        raise ValueError('工程路径必须为规范相对路径：' + repr(relative))
    if any(ord(char) < 32 or ord(char) == 127 for char in relative):
        raise ValueError('工程路径含控制字符')
    path = PurePosixPath(relative)
    if path.is_absolute() or any(part in {'', '.', '..'} for part in relative.split('/')):
        raise ValueError('工程路径含绝对路径、空段或回退段：' + relative)
    reserved = {'CON', 'PRN', 'AUX', 'NUL'} | {
        prefix + str(number) for prefix in ['COM', 'LPT'] for number in range(1, 10)}
    for part in path.parts:
        if (part.endswith((' ', '.')) or any(char in part for char in '<>"|?*')
                or part.split('.')[0].upper() in reserved):
            raise ValueError('工程路径不能在常用系统中安全解压：' + relative)
    return path


def forbidden(relative):
    """隐私、凭据、依赖目录及候选/临时场景不能被输入锁重新纳入。"""
    path = safe_relative(relative)
    parts = [part.lower() for part in path.parts]
    if any(part in FORBIDDEN_PARTS or part.startswith('.env') for part in parts):
        return True
    if any(re.search(r'(^|[-_])(candidate|preflight|diagnostic|probe)([-_]|$)', part)
           for part in parts):
        return True
    # 这份已冻结纠正夹具的v2属于来源格式身份；只豁免该精确路径的版本命名规则。
    if (relative not in VERSIONED_REFERENCE_INPUTS
            and any(re.search(r'(^|[-_.])v\d+($|[-_.])', part) for part in parts)):
        return True
    if path.suffix.lower() in {'.pyc', '.pyo', '.blend1', '.blend2', '.tsbuildinfo',
                              '.pem', '.key', '.p12', '.pfx', '.zip', '.7z', '.tar', '.gz', '.npy', '.npz'}:
        return True
    if (path.name in {'.DS_Store', '.npmrc', '.pypirc', '.netrc', MANIFEST, 'scene.json'}
            or re.search(r'(^|[-_.])(credentials?|secrets?|id_rsa|id_ed25519)([-_.]|$)',
                         path.name.lower())):
        return True
    if path.name.startswith(('DELIVERY_MANIFEST_', 'DELIVERY_SPLIT_', 'VERIFICATION_RESOURCES_')):
        return True
    if any(part in {'reference', 'references'} for part in parts):
        if path.suffix.lower() in MEDIA_SUFFIXES:
            return True
        # 参考区只保存精简数据和报告，不分发历史整机或不透明二进制。
        if relative.startswith('qa/reference/') and path.suffix.lower() not in SOURCE_SUFFIXES:
            return True
    return False


def selected(relative):
    """默认选择当前应用与必要文本；忽略规则不影响正式锁中的合法依赖。"""
    path = safe_relative(relative)
    if forbidden(relative):
        return False
    if relative in MANDATORY or relative == '.gitignore':
        return True
    if relative.startswith('dist/'):
        return False
    if relative.startswith('public/'):
        return True
    if relative.startswith(('src/', 'python/', 'examples/', 'docs/')):
        return path.suffix.lower() in SOURCE_SUFFIXES | {'.svg'}
    if relative.startswith('scripts/'):
        return path.suffix.lower() in SOURCE_SUFFIXES
    if relative.startswith(('qa/lib/', 'qa/contracts/', 'qa/reference/')):
        return path.suffix.lower() in SOURCE_SUFFIXES
    if relative.startswith('qa/visual/'):
        # 当前成片、渲染脚本和报告只取直接子文件，不纳入逐帧、场景或准备目录。
        return len(path.parts) == 3 and path.suffix.lower() in SOURCE_SUFFIXES | MEDIA_SUFFIXES
    if relative.startswith('qa/current/results/') or relative.startswith('qa/frontend/'):
        return path.suffix.lower() in SOURCE_SUFFIXES | {'.log'}
    if relative.startswith('qa/current/'):
        return len(path.parts) == 3 and path.suffix.lower() in SOURCE_SUFFIXES
    if relative.startswith('qa/'):
        return len(path.parts) == 2 and path.suffix.lower() in SOURCE_SUFFIXES
    return False


def input_path(relative, root):
    """不跟随符号链接；只读取本工程内的普通文件。"""
    safe_relative(relative)
    if forbidden(relative):
        raise ValueError('工程输入被安全或隐私规则排除：' + relative)
    root = Path(root).resolve()
    cursor = root
    for part in PurePosixPath(relative).parts:
        cursor /= part
        if cursor.is_symlink():
            raise ValueError('工程输入不得通过符号链接读取：' + relative)
    if not cursor.is_file() or not cursor.resolve().is_relative_to(root):
        raise ValueError('工程输入缺失或超出目录：' + relative)
    return cursor


def locked_inputs(data):
    lock = json.loads(data)
    rows = lock.get('files') if isinstance(lock, dict) else None
    if not isinstance(rows, list) or not rows:
        raise ValueError('最终输入锁没有文件')
    required = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('冻结输入条目必须为对象')
        relative, sha = row.get('path'), row.get('sha256')
        safe_relative(relative)
        if forbidden(relative):
            raise ValueError('冻结锁包含禁止交付的输入：' + relative)
        if relative in required or not isinstance(sha, str) or not re.fullmatch('[a-f0-9]{64}', sha):
            raise ValueError('重复冻结路径或非法SHA256：' + relative)
        required[relative] = sha
    return required


def stage_names(data):
    stages = json.loads(data)
    if (not isinstance(stages, list) or not stages
            or any(not isinstance(name, str) or not re.fullmatch('[a-z][a-z0-9-]*', name)
                   for name in stages) or len(set(stages)) != len(stages)):
        raise ValueError('独立验收阶段清单缺失、格式错误或包含重复项')
    return stages


def validate_summary(data, expected_stages, lock_count, label):
    summary = json.loads(data)
    if (not isinstance(summary, dict) or summary.get('modelVersion') != MODEL_SCHEMA
            or summary.get('passed') is not True or summary.get('inputStability') is not True):
        raise ValueError(label + '尚无最终通过且输入稳定的汇总')
    if type(summary.get('inputLockFiles')) is not int or summary['inputLockFiles'] != lock_count:
        raise ValueError(label + '汇总与输入锁计数不一致')
    if summary.get('changedInputs', []) != [] or summary.get('distributionError') is not None:
        raise ValueError(label + '汇总仍有输入漂移或构建引用错误')
    stages = summary.get('stages')
    if (not isinstance(stages, list) or any(not isinstance(row, dict) for row in stages)
            or [row.get('name') for row in stages] != expected_stages):
        raise ValueError(label + '汇总阶段顺序、数量或名称与冻结约定不一致')
    if any(type(row.get('exitCode')) is not int or row['exitCode'] != 0 for row in stages):
        raise ValueError(label + '汇总仍有未通过的验证阶段')
    return summary


def validate_stage_evidence(read_once, stages):
    """汇总不能替代实际阶段记录、原始报告和日志。"""
    expected = ''.join(name + ' 0\n' for name in stages)
    if read_once(STATUS).decode('utf-8').replace('\r\n', '\n') != expected:
        raise ValueError('正式物理阶段记录与冻结阶段清单不一致')
    for name in stages:
        read_once('qa/current/results/' + name + '.log')
        if name not in LOG_ONLY_STAGES:
            report = json.loads(read_once('qa/current/results/' + name + '-report.json'))
            if not isinstance(report, dict) or report.get('passed') is not True:
                raise ValueError('正式物理阶段原始报告未通过：' + name)
    for name in FRONTEND_STAGES:
        read_once('qa/frontend/' + name + '.log')


def validate_checksum_list(data, locked, label):
    """保留并核对原始逐文件校验清单，不能用后来重写的摘要替代。"""
    expected = ''.join(sha + '  ' + relative + '\n' for relative, sha in locked.items())
    if data.decode('utf-8').replace('\r\n', '\n') != expected:
        raise ValueError(label + '逐文件校验清单与输入锁不一致')


def supplement_module_closure(root, read_once, entries):
    """独立追踪修订入口的静态本地模块边，拒绝删锁后仅重写计数蒙混过关。"""
    extensions = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '.cts', '.cjs', '.json']
    expected, queue = set(entries), sorted(entries)
    while queue:
        relative = queue.pop()
        if PurePosixPath(relative).suffix not in set(extensions) - {'.json'}:
            continue
        source = read_once(relative).decode('utf-8')
        references = re.findall(
            r'''(?:\bfrom\s*|\b(?:import|require|tsImport)\s*\(\s*|\bimport\s*)["'](\.{1,2}(?:/[^"'\n]*)?)["']''',
            source)
        candidates = [posixpath.normpath(posixpath.join(posixpath.dirname(relative), name))
                      for name in references]
        # 两份独立补充审计以明确的工程根变量动态加载本地模块。
        candidates += re.findall(r'''\bimport\s*\(\s*project\s*\+\s*["']/([^"'\n]+)["']''', source)
        for candidate in candidates:
            safe_relative(candidate)
            suffix = PurePosixPath(candidate).suffix
            choices = [candidate]
            if not suffix:
                choices += [candidate + ext for ext in extensions]
                choices += [candidate + '/index' + ext for ext in extensions]
            else:
                typed = {'.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts']}
                choices += [str(PurePosixPath(candidate).with_suffix(ext)) for ext in typed.get(suffix, [])]
            child = next((name for name in choices if (root / name).is_file() or (root / name).is_symlink()), None)
            if child is None:
                raise ValueError('補充本地模块缺失：' + relative + ' -> ' + candidate)
            read_once(child)
            if child not in expected:
                expected.add(child)
                queue.append(child)
    return expected


def validate_hardening_supplement(root, read_once, physics):
    """原65阶段只按四份旧字节还原；当前硬化代码必须另有定向通过证据。"""
    supplement_data = read_once(SUPPLEMENT_LOCK)
    supplement = locked_inputs(supplement_data)
    overlay = json.loads(read_once(ORIGINAL_OVERLAY))
    original = json.loads(read_once(SUMMARY))
    summary = json.loads(read_once(SUPPLEMENT_SUMMARY))
    stages = stage_names(read_once(GEOMETRY_STAGES_PATH))
    if len(physics) != 290 or len(stages) != 65:
        raise ValueError('硬化补充只能关联原65阶段、290项冻结输入')
    if not isinstance(overlay, dict) or not isinstance(summary, dict) or not isinstance(original, dict):
        raise ValueError('硬化补充或原始输入覆盖层格式错误')
    bindings = {'sourceSha256': 'assets/blender/xp4-source.glb',
                'runtimeSha256': 'public/models/xp4.glb',
                'sourceBlendSha256': 'assets/blender/xp4.blend'}
    for key, relative in bindings.items():
        sha = digest(read_once(relative))
        if original.get(key) != sha or summary.get(key) != sha:
            raise ValueError('硬化补充与原65阶段模型哈希不一致：' + relative)
        if key != 'sourceBlendSha256' and overlay.get(key) != sha:
            raise ValueError('原始输入覆盖层模型哈希不一致：' + relative)
    if (overlay.get('fullRunSummaryPath') != SUMMARY
            or overlay.get('fullRunInputLockPath') != LOCK
            or overlay.get('fullRunSummarySha256') != digest(read_once(SUMMARY))
            or overlay.get('fullRunInputLockSha256') != digest(read_once(LOCK))):
        raise ValueError('原始输入覆盖层未绑定原65阶段证据')
    rows = overlay.get('overlays')
    if (not isinstance(rows, list) or len(rows) != len(HARDENED_INPUTS)
            or any(not isinstance(row, dict) or not isinstance(row.get('path'), str) for row in rows)
            or {row['path'] for row in rows} != HARDENED_INPUTS):
        raise ValueError('原始输入覆盖层只能包含明确批准的四项硬化输入')
    stored, current, differences = set(), dict(physics), []
    for row in sorted(rows, key=lambda item: item['path']):
        relative = row['path']
        expected = ORIGINAL_INPUT_DIR + '/' + relative
        if (row.get('storedPath') != expected or relative not in physics
                or row.get('sha256') != physics[relative]
                or digest(read_once(expected)) != physics[relative]):
            raise ValueError('原始输入覆盖层旧字节、路径或SHA256不一致：' + relative)
        sha = digest(read_once(relative))
        if sha == physics[relative]:
            raise ValueError('声明硬化的输入未发生修订：' + relative)
        stored.add(expected)
        current[relative] = sha
        differences.append({'path': relative, 'originalSha256': physics[relative],
                            'currentSha256': sha, 'originalBytes': expected})
    for relative, sha in physics.items():
        if relative not in HARDENED_INPUTS and digest(read_once(relative)) != sha:
            raise ValueError('原65阶段出现未批准的输入漂移：' + relative)
    required = set(physics) | stored | SUPPLEMENT_DEPENDENCIES | {ORIGINAL_OVERLAY}
    required |= supplement_module_closure(root, read_once, HARDENED_INPUTS | SUPPLEMENT_DEPENDENCIES)
    for path in (root / 'qa/current/results').iterdir():
        if path.is_file() or path.is_symlink():
            required.add(path.relative_to(root).as_posix())
    missing = required - set(supplement)
    if missing:
        raise ValueError('补充输入锁缺少原始证据或当前必要依赖：' + ', '.join(sorted(missing)))
    # 新锁冻结当前路径与历史覆盖层两套字节；不允许以新锁任意豁免原始漂移。
    for relative, sha in supplement.items():
        if relative in current and current[relative] != sha:
            raise ValueError('补充输入锁与原始重建证据互相冲突：' + relative)
        if digest(read_once(relative)) != sha:
            raise ValueError('补充冻结输入已变化：' + relative)
    lock_info = json.loads(supplement_data)
    if (lock_info.get('fullRunSummarySha256') != digest(read_once(SUMMARY))
            or any(lock_info.get(key) != summary[key] for key in ['sourceSha256', 'runtimeSha256'])):
        raise ValueError('补充输入锁未绑定原始汇总和同一模型')
    full = summary.get('originalFullRun')
    targeted = summary.get('currentTargetedValidation')
    if (summary.get('passed') is not True or summary.get('fullChainRerunAfterHardening') is not False
            or not isinstance(full, dict) or full.get('summaryPath') != SUMMARY
            or full.get('summarySha256') != digest(read_once(SUMMARY))
            or full.get('inputLockPath') != LOCK or full.get('inputLockSha256') != digest(read_once(LOCK))
            or type(full.get('stages')) is not int or full['stages'] != 65
            or type(full.get('inputFiles')) is not int or full['inputFiles'] != 290
            or full.get('allStagesPassed') is not True or full.get('overlayPath') != ORIGINAL_OVERLAY
            or not isinstance(targeted, dict) or targeted.get('inputStability') is not True
            or targeted.get('inputLockPath') != SUPPLEMENT_LOCK
            or targeted.get('inputLockSha256') != digest(supplement_data)
            or type(targeted.get('inputFiles')) is not int or targeted['inputFiles'] != len(supplement)):
        raise ValueError('补充汇总没有严格区分原65阶段与修后定向验证')
    changed = summary.get('changedOriginalInputs')
    if (not isinstance(changed, list) or any(not isinstance(row, dict) for row in changed)
            or sorted(changed, key=lambda row: str(row.get('path'))) != differences):
        raise ValueError('补充汇总的四项输入变更与原字节覆盖层不一致')
    targeted_stages = targeted.get('stages')
    if (not isinstance(targeted_stages, list)
            or any(not isinstance(row, dict) for row in targeted_stages)
            or [row.get('name') for row in targeted_stages] != SUPPLEMENT_STAGES
            or any(type(row.get('exitCode')) is not int or row['exitCode'] != 0
                   for row in targeted_stages)):
        raise ValueError('补充汇总的定向阶段顺序、数量或结果错误')
    expected_status = ''.join(name + ' 0\n' for name in SUPPLEMENT_STAGES)
    if read_once(SUPPLEMENT_DIR + '/status.log').decode('utf-8').replace('\r\n', '\n') != expected_status:
        raise ValueError('补充阶段记录与定向阶段约定不一致')
    reports = targeted.get('reports')
    if not isinstance(reports, dict) or set(reports) != set(SUPPLEMENT_STAGES[:-1]):
        raise ValueError('补充汇总缺少定向原始报告绑定')
    for name in SUPPLEMENT_STAGES:
        read_once(SUPPLEMENT_DIR + '/' + name + '.log')
        if name == 'input-stability':
            continue
        relative = SUPPLEMENT_DIR + '/' + name + '-report.json'
        data = read_once(relative)
        report, binding = json.loads(data), reports[name]
        if (not isinstance(binding, dict) or binding.get('path') != relative
                or binding.get('sha256') != digest(data)
                or not isinstance(report, dict) or report.get('passed') is not True):
            raise ValueError('补充原始报告未通过或字节绑定失效：' + name)
        if name in {'indexed-host-material', 'unused-points-regression'}:
            if report.get('sourceSha256') != summary['sourceSha256']:
                raise ValueError('补充原始报告未绑定当前源模型：' + name)
        if name == 'nacelle-placement':
            variants = report.get('reports')
            if (not isinstance(variants, list) or len(variants) != 2
                    or any(not isinstance(row, dict) for row in variants)
                    or [row.get('encoding') for row in variants] != ['source', 'runtime']
                    or any(row.get('passed') is not True or row.get('failures') != []
                           or row.get('sha256') != summary[row['encoding'] + 'Sha256'] for row in variants)):
                raise ValueError('补充布局报告缺少源和运行模型通过证据')
    validate_checksum_list(read_once('qa/current/results/input-sha256.txt'), physics, '原65阶段')
    validate_checksum_list(read_once(SUPPLEMENT_DIR + '/input-sha256.txt'), supplement, '定向补充')
    return current, supplement, summary


def glb_counts(data):
    """只读运行GLB的JSON块，计数不依赖外部模型库。"""
    if len(data) < 20:
        raise ValueError('运行模型不是完整GLB')
    magic, version, length, size, kind = struct.unpack_from('<4sIIII', data)
    if magic != b'glTF' or version != 2 or length != len(data) or kind != 0x4e4f534a or 20 + size > length:
        raise ValueError('运行模型GLB头或JSON块无效')
    model = json.loads(data[20:20 + size])
    nodes, meshes = model.get('nodes'), model.get('meshes')
    if not isinstance(nodes, list) or not isinstance(meshes, list) or not nodes or not meshes:
        raise ValueError('运行模型缺少实际节点或网格')
    used = [node['mesh'] for node in nodes if isinstance(node, dict) and 'mesh' in node]
    if any(type(index) is not int or index < 0 or index >= len(meshes) for index in used):
        raise ValueError('运行模型含无效网格索引')
    return {'实际网格数': len(used), '实际节点数': len(nodes), '复用网格资源数': len(meshes)}


def validate_project_metadata(contents, summaries, locks, supplement_summary=None):
    """项目元数据必须绑定本次真实文件与验收；待验收空值不能进入最终工程包。"""
    info = json.loads(contents[METADATA])
    if not isinstance(info, dict) or not isinstance(info.get('项目名称'), str) or not info['项目名称'].strip():
        raise ValueError('项目信息缺少项目名称')
    for label, relative in [('网页模型', 'public/models/xp4.glb'),
                            ('独立模型', 'assets/blender/xp4-source.glb'),
                            ('Blender源', 'assets/blender/xp4.blend')]:
        if (info.get(label + 'SHA256') != digest(contents[relative])
                or type(info.get(label + '字节数')) is not int
                or info[label + '字节数'] != len(contents[relative])):
            raise ValueError('项目信息的模型哈希或字节数未冻结：' + relative)
    for key, relative in [('概念模块SHA256', 'public/models/nacelle-system-concept.glb'),
                          ('概念模块源SHA256', 'assets/blender/nacelle-system-concept-source.glb'),
                          ('模型清单SHA256', 'public/models/manifest.json')]:
        if info.get(key) != digest(contents[relative]):
            raise ValueError('项目信息的静态资产哈希未冻结：' + relative)
    for key, count in glb_counts(contents['public/models/xp4.glb']).items():
        if type(info.get(key)) is not int or info[key] != count:
            raise ValueError('项目信息的模型计数未冻结：' + key)
    union_count = len(set().union(*locks))
    if type(info.get('合并冻结输入数')) is not int or info['合并冻结输入数'] != union_count:
        raise ValueError('项目信息的合并冻结输入数不一致')
    for index, (label, summary_path, lock_path) in enumerate([
            ('最终验收', SUMMARY, LOCK), ('前端验收', FRONTEND_SUMMARY, FRONTEND_LOCK)]):
        row = info.get(label)
        if (not isinstance(row, dict) or row.get('全部通过') is not True or row.get('输入稳定') is not True
                or row.get('路径') != summary_path or row.get('输入锁路径') != lock_path
                or row.get('SHA256') != digest(contents[summary_path])
                or row.get('输入锁SHA256') != digest(contents[lock_path])
                or type(row.get('阶段数')) is not int or row['阶段数'] != len(summaries[index]['stages'])
                or type(row.get('冻结输入数')) is not int or row['冻结输入数'] != len(locks[index])):
            raise ValueError('项目信息尚未绑定最终通过汇总和冻结锁：' + label)
    if supplement_summary is not None:
        row = info.get('定向补充验收')
        if (not isinstance(row, dict) or row.get('全部通过') is not True
                or row.get('输入稳定') is not True or row.get('路径') != SUPPLEMENT_SUMMARY
                or row.get('SHA256') != digest(contents[SUPPLEMENT_SUMMARY])
                or row.get('输入锁路径') != SUPPLEMENT_LOCK
                or row.get('输入锁SHA256') != digest(contents[SUPPLEMENT_LOCK])
                or type(row.get('阶段数')) is not int or row['阶段数'] != len(SUPPLEMENT_STAGES)
                or type(row.get('冻结输入数')) is not int or row['冻结输入数'] != len(locks[2])
                or info.get('修后完整65阶段重跑') is not False
                or info.get('原始输入覆盖层路径') != ORIGINAL_OVERLAY
                or info.get('原始输入覆盖层SHA256') != digest(contents[ORIGINAL_OVERLAY])):
            raise ValueError('项目信息尚未绑定定向补充验收和原始输入覆盖层')
    return info


def validate_frontend_preservation(contents, frontend_lock):
    summary = json.loads(contents[FRONTEND_SUMMARY])
    report = json.loads(contents[BUILD_PRESERVATION])
    if (not isinstance(report, dict) or summary.get('nonDeletingBuild') is not True
            or report.get('passed') is not True or report.get('removedPaths') != []
            or summary.get('buildPreservationPath') != BUILD_PRESERVATION
            or summary.get('buildPreservationSha256') != digest(contents[BUILD_PRESERVATION])):
        raise ValueError('前端没有绑定非删除式构建通过报告')
    current = report.get('currentDistributionFiles')
    locked_dist = {name for name in frontend_lock if name.startswith('dist/')}
    if (not isinstance(current, list) or not current
            or any(not isinstance(name, str) for name in current)
            or len(set(current)) != len(current) or set(current) != locked_dist
            or type(summary.get('currentDistributionFiles')) is not int
            or summary['currentDistributionFiles'] != len(current)):
        raise ValueError('前端当前构建闭包与冻结输入不一致')
    return locked_dist


def validate_packaging_selftest(contents):
    """打包工具与其合成自测单独写入工程清单，不混入前端冻结锁。"""
    report = json.loads(contents[SELFTEST])
    expected = {name: digest(contents[name]) for name in PACKAGING_TOOLS}
    if (not isinstance(report, dict) or report.get('全部通过') is not True
            or type(report.get('测试数')) is not int or report['测试数'] < 1
            or report.get('脚本SHA256') != expected):
        raise ValueError('打包工具尚无通过的自测或脚本在自测后发生变化')
    return expected


class EntryReferences(HTMLParser):
    """只读取入口实际加载的资源，不将普通超链接当成运行依赖。"""
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag in {'script', 'img', 'iframe', 'source', 'audio', 'video'} and values.get('src'):
            self.references.append(values['src'])
        if tag == 'link' and values.get('href'):
            self.references.append(values['href'])
        if values.get('poster'):
            self.references.append(values['poster'])


def distribution_references(relative, data):
    """独立解析HTML/JS/CSS中的明确资源引用，避免调用或信任被打包的代码。"""
    suffix = PurePosixPath(relative).suffix.lower()
    if suffix not in {'.html', '.js', '.mjs', '.css'}:
        return []
    text = data.decode('utf-8')
    if suffix == '.html':
        parser = EntryReferences()
        parser.feed(text)
        references = parser.references
    elif suffix == '.css':
        references = re.findall(r'''url\(\s*["']?([^"'\s)]+)["']?\s*\)''', text)
        references += re.findall(r'''@import\s*["']([^"']+)["']''', text)
    else:
        references = re.findall(r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']''', text)
        references += re.findall(r'''new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url''', text)
        references += re.findall(r'''["'`](/assets/[^"'`\s]+)["'`]''', text)
        references += ['/' + name for name in re.findall(r'''["'`](assets/[^"'`\s]+)["'`]''', text)]
    return [link for link in references if '${' not in link
            and PurePosixPath(urlsplit(link).path).suffix.lower() in ASSET_SUFFIXES]


def validate_distribution(contents, locked_dist):
    """从当前入口和静态资源推导真实引用闭包，拒绝缺失资源或夹带旧构建。"""
    expected = {'dist/index.html'}
    for relative, data in contents.items():
        if relative.startswith('public/'):
            target = 'dist/' + relative.removeprefix('public/')
            if contents.get(target) != data:
                raise ValueError('预构建网页与当前静态源字节不一致：' + relative)
            expected.add(target)
    queue = sorted(expected)
    while queue:
        relative = queue.pop()
        if relative not in contents:
            raise ValueError('当前构建资源引用缺失：' + relative)
        for reference in distribution_references(relative, contents[relative]):
            url = urlsplit(reference)
            if url.scheme or url.netloc or not url.path:
                continue
            url_path = unquote(url.path)
            if '\\' in url_path or '\x00' in url_path:
                raise ValueError('构建引用含不安全路径：' + reference)
            target = ('dist/' + url_path.lstrip('/') if url_path.startswith('/') else
                      posixpath.normpath(posixpath.join(posixpath.dirname(relative), url_path)))
            safe_relative(target)
            if not target.startswith('dist/'):
                raise ValueError('构建引用超出dist：' + reference)
            if target not in contents:
                raise ValueError('当前构建资源引用缺失：' + target)
            if target not in expected:
                expected.add(target)
                queue.append(target)
    actual = {relative for relative in contents if relative.startswith('dist/')}
    if actual != locked_dist or expected != locked_dist:
        raise ValueError('当前构建引用闭包、前端锁与归档文件集合不一致')


def scan_candidates(root):
    """不依赖Git索引或忽略配置，不进入被排除目录，不跟随符号链接。"""
    for directory, subdirs, files in os.walk(root, followlinks=False):
        parent = Path(directory)
        subdirs[:] = sorted(name for name in subdirs
                           if not forbidden((parent / name).relative_to(root).as_posix()))
        for name in sorted(files):
            relative = (parent / name).relative_to(root).as_posix()
            if selected(relative):
                yield relative


def validate_unique_paths(paths):
    """Windows大小写及Unicode等价名称也不能覆盖另一条归档文件。"""
    canonical = Counter(unicodedata.normalize('NFC', name).casefold() for name in paths)
    if any(count > 1 for count in canonical.values()):
        raise ValueError('工程路径存在大小写或Unicode等价冲突')


def validate_frontend_coverage(root, frontend_lock):
    """独立核对源码根和真实相对引用，不能靠删锁条目后修改计数掩盖缺项。"""
    expected = set(FRONTEND_FILES)
    for base in FRONTEND_ROOTS:
        for directory, subdirs, files in os.walk(root / base, followlinks=False):
            parent = Path(directory)
            subdirs[:] = [name for name in subdirs
                          if not forbidden((parent / name).relative_to(root).as_posix())]
            for name in files:
                relative = (parent / name).relative_to(root).as_posix()
                if not forbidden(relative):
                    input_path(relative, root)
                    expected.add(relative)
    queue = sorted(expected)
    while queue:
        relative = queue.pop()
        if PurePosixPath(relative).suffix not in FRONTEND_CODE_SUFFIXES:
            continue
        source = input_path(relative, root)
        for reference in re.findall(r'''["'](\.{1,2}/[^"'\n]+)["']''', source.read_text(encoding='utf-8')):
            if '${' in reference or '?' in reference or '#' in reference:
                continue
            candidate = Path(os.path.normpath(source.parent / reference))
            choices = [candidate] + [Path(str(candidate) + suffix) for suffix in FRONTEND_CODE_SUFFIXES]
            if candidate.suffix in {'.js', '.mjs', '.jsx'}:
                choices.extend(candidate.with_suffix(suffix) for suffix in ['.ts', '.tsx', '.mts'])
            choices.extend(candidate / ('index' + suffix) for suffix in FRONTEND_CODE_SUFFIXES)
            for child in choices:
                if child.is_relative_to(root) and child.is_file() and 'node_modules' not in child.parts:
                    name = child.relative_to(root).as_posix()
                    input_path(name, root)
                    if name not in expected:
                        expected.add(name)
                        queue.append(name)
                    break
    validate_unique_paths(expected)
    missing = expected - set(frontend_lock)
    if missing:
        raise ValueError('前端冻结锁未覆盖实际应用输入：' + ', '.join(sorted(missing)))


def zip_member(relative, data, mode=0o644):
    info = zipfile.ZipInfo(PREFIX + relative, date_time=(2026, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | mode) << 16
    return info, data


def validate_archive(payload, manifest_bytes):
    """逐条核验CRC、SHA256、长度、权限和完整文件集合，包括清单本身。"""
    manifest = json.loads(manifest_bytes)
    rows = manifest['files']
    names = [PREFIX + row['path'] for row in rows] + [PREFIX + MANIFEST]
    validate_unique_paths(names)
    with zipfile.ZipFile(BytesIO(payload)) as archive:
        if archive.testzip() is not None:
            raise ValueError('完整工程包CRC校验失败')
        if len(archive.namelist()) != len(names) or set(archive.namelist()) != set(names):
            raise ValueError('完整工程包文件集合错误或含重复条目')
        for row in rows + [{'path': MANIFEST, 'bytes': len(manifest_bytes),
                             'sha256': digest(manifest_bytes),
                             'crc32': f'{zlib.crc32(manifest_bytes):08x}', 'mode': '0644'}]:
            name = PREFIX + row['path']
            safe_relative(row['path'])
            info, data = archive.getinfo(name), archive.read(name)
            mode = info.external_attr >> 16
            if (not stat.S_ISREG(mode) or stat.S_IMODE(mode) != int(row['mode'], 8)
                    or len(data) != row['bytes'] or digest(data) != row['sha256']
                    or f'{info.CRC:08x}' != row['crc32'] or f'{zlib.crc32(data):08x}' != row['crc32']):
                raise ValueError('包内文件长度、哈希、CRC或权限不一致：' + row['path'])
        if archive.read(PREFIX + MANIFEST) != manifest_bytes:
            raise ValueError('包内清单字节不一致')
        largest = sorted(archive.infolist(), key=lambda item: item.compress_size, reverse=True)[:12]
    return [{'path': item.filename, 'bytes': item.compress_size} for item in largest]


def prepare_package(root):
    """只构造与核验内存快照；成功前不触碰任何输出文件。"""
    root = Path(root).resolve()
    contents, modes = {}, {}

    def read_once(relative):
        if relative not in contents:
            path = input_path(relative, root)
            contents[relative] = path.read_bytes()
            modes[relative] = 0o755 if path.stat().st_mode & 0o111 else 0o644
        return contents[relative]

    physics = locked_inputs(read_once(LOCK))
    frontend = locked_inputs(read_once(FRONTEND_LOCK))
    supplement, supplement_summary = {}, None
    # 任一证据目录存在即要求整套补充证据，缺失文件不能静默退回旧验收口径。
    has_supplement = any(os.path.lexists(root / relative)
                         for relative in [SUPPLEMENT_DIR, ORIGINAL_INPUT_DIR])
    if has_supplement:
        required, supplement, supplement_summary = validate_hardening_supplement(root, read_once, physics)
        required.update(supplement)
    else:
        required = dict(physics)
    for relative, sha in frontend.items():
        if relative in required and required[relative] != sha:
            raise ValueError('独立物理与前端冻结输入互相冲突：' + relative)
        required[relative] = sha
    if (set(PACKAGING_TOOLS) | {SELFTEST, MANIFEST}) & set(required):
        raise ValueError('打包工具及自测须由清单单独绑定，不得混入验收输入锁')
    physics_required = SURFACE_INPUTS | {GEOMETRY_STAGES_PATH, 'public/models/xp4.glb',
                                        'assets/blender/xp4-source.glb', 'assets/blender/xp4.blend'}
    if not physics_required.issubset(physics):
        raise ValueError('物理输入锁缺少阶段约定、当前模型或必要蒙皮模板：'
                         + ', '.join(sorted(physics_required - set(physics))))
    validate_frontend_coverage(root, frontend)
    stages = stage_names(read_once(GEOMETRY_STAGES_PATH))
    summaries = [validate_summary(read_once(SUMMARY), stages, len(physics), '物理'),
                 validate_summary(read_once(FRONTEND_SUMMARY), FRONTEND_STAGES, len(frontend), '前端')]
    for relative in sorted(set(scan_candidates(root)) | set(required) | MANDATORY):
        read_once(relative)
    validate_unique_paths(contents)
    for relative, sha in required.items():
        if digest(contents[relative]) != sha:
            raise ValueError('冻结输入已变化：' + relative)
    for key, relative in [('runtimeSha256', 'public/models/xp4.glb'),
                          ('sourceSha256', 'assets/blender/xp4-source.glb'),
                          ('sourceBlendSha256', 'assets/blender/xp4.blend')]:
        if summaries[0].get(key) != digest(contents[relative]):
            raise ValueError('最终物理汇总模型哈希不一致：' + relative)
    if summaries[1].get('runtimeSha256') != digest(contents['public/models/xp4.glb']):
        raise ValueError('前端汇总运行模型哈希不一致')
    validate_stage_evidence(read_once, stages)
    locked_dist = validate_frontend_preservation(contents, frontend)
    validate_distribution(contents, locked_dist)
    validate_project_metadata(contents, summaries, [physics, frontend, supplement], supplement_summary)
    packaging_tools = validate_packaging_selftest(contents)
    entries = [{'path': relative, 'bytes': len(data), 'sha256': digest(data),
                'crc32': f'{zlib.crc32(data):08x}', 'mode': f'{modes[relative]:04o}'}
               for relative, data in sorted(contents.items())]
    manifest = {
        'schemaVersion': 1, 'projectName': 'Transwing 飞行展示工作室',
        'scope': '单一当前完整工程：应用、可编辑源、生成链、Python、当前预构建网页、正式验收与全部冻结复验依赖',
        'distributionPolicy': '保留磁盘旧构建和旧工程；单包只纳入当前引用闭包，不拆分、不删除必要依赖',
        'packagingSelftestPath': SELFTEST, 'packagingSelftestSha256': digest(contents[SELFTEST]),
        'packagingTools': packaging_tools, 'lockedInputs': len(physics),
        'frontendLockedInputs': len(frontend), 'combinedLockedInputs': len(required),
        'inputLockPath': LOCK, 'inputLockSha256': digest(contents[LOCK]),
        'verificationSummaryPath': SUMMARY, 'verificationSummarySha256': digest(contents[SUMMARY]),
        'frontendInputLockPath': FRONTEND_LOCK, 'frontendInputLockSha256': digest(contents[FRONTEND_LOCK]),
        'frontendSummaryPath': FRONTEND_SUMMARY, 'frontendSummarySha256': digest(contents[FRONTEND_SUMMARY]),
        'buildPreservationPath': BUILD_PRESERVATION,
        'buildPreservationSha256': digest(contents[BUILD_PRESERVATION]),
        'projectMetadataPath': METADATA, 'projectMetadataSha256': digest(contents[METADATA]),
        'files': entries,
    }
    if has_supplement:
        manifest.update({
            'validationMode': 'original-full-chain-with-targeted-hardening',
            'fullChainRerunAfterHardening': False,
            'supplementLockedInputs': len(supplement),
            'supplementInputLockPath': SUPPLEMENT_LOCK,
            'supplementInputLockSha256': digest(contents[SUPPLEMENT_LOCK]),
            'supplementSummaryPath': SUPPLEMENT_SUMMARY,
            'supplementSummarySha256': digest(contents[SUPPLEMENT_SUMMARY]),
            'originalInputOverlayPath': ORIGINAL_OVERLAY,
            'originalInputOverlaySha256': digest(contents[ORIGINAL_OVERLAY]),
        })
    manifest_bytes = encoded(manifest)
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for row in entries:
            info, data = zip_member(row['path'], contents[row['path']], modes[row['path']])
            archive.writestr(info, data, compresslevel=9)
        info, data = zip_member(MANIFEST, manifest_bytes)
        archive.writestr(info, data, compresslevel=9)
    payload = buffer.getvalue()
    largest = validate_archive(payload, manifest_bytes)
    # 归档压缩期间仍可能有人改文件；落盘前再核验全部已读取内容，拒绝静默漂移。
    for relative, data in contents.items():
        if input_path(relative, root).read_bytes() != data:
            raise ValueError('打包期间输入已变化：' + relative)
    result = {
        'bytes': len(payload), 'mib': round(len(payload) / (1024 * 1024), 3),
        'sha256': digest(payload), 'files': len(entries), 'archiveEntries': len(entries) + 1,
        'manifestSha256': digest(manifest_bytes), 'manifestCrc32': f'{zlib.crc32(manifest_bytes):08x}',
        'lockedInputs': len(physics), 'frontendLockedInputs': len(frontend),
        'combinedLockedInputs': len(required), 'largestCompressed': largest,
    }
    if has_supplement:
        result.update({'supplementLockedInputs': len(supplement),
                       'fullChainRerunAfterHardening': False})
    return payload, manifest_bytes, result


def write_package(root, output, overwrite=False):
    """仅覆盖明确指定且获准覆盖的输出；不建暂存目录，不删除任何路径。"""
    root = Path(root).resolve()
    output = Path(output).absolute()
    if output.is_symlink() or any(parent.is_symlink() for parent in output.parents):
        raise ValueError('输出不得通过符号链接写入')
    output = output.resolve()
    if output.is_relative_to(root):
        raise ValueError('完整工程包必须写到工程目录外')
    if output.exists() and (not output.is_file() or not overwrite):
        raise ValueError('输出已存在；仅在明确指定 --overwrite 时覆盖该文件')
    payload, manifest_bytes, result = prepare_package(root)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('wb' if overwrite else 'xb') as stream:
        stream.write(payload)
    actual = output.read_bytes()
    if actual != payload:
        raise ValueError('完整工程包落盘字节校验失败')
    validate_archive(actual, manifest_bytes)
    return {'path': str(output), **result}


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='工程目录之外的单一完整ZIP路径')
    parser.add_argument('--overwrite', action='store_true', help='核验通过后覆盖明确指定的现有输出文件')
    args = parser.parse_args()
    print(json.dumps(write_package(ROOT, args.output, args.overwrite), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
