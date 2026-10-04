"""运行V24前端五阶段，冻结递归源码依赖与当前构建引用，并检查构建不删除旧文件。"""
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit
import hashlib
import json
import os
import posixpath
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'qa/frontend'
TEXT_SOURCE_SUFFIXES = {'.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx'}
DIST_TEXT_SUFFIXES = {'.html', '.js', '.mjs', '.css'}
DIST_ASSET_SUFFIXES = DIST_TEXT_SUFFIXES | {
    '.json', '.wasm', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico',
    '.woff', '.woff2', '.ttf', '.otf', '.glb', '.gltf', '.bin', '.mp4', '.webm',
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def project_file(path, root=ROOT):
    """拒绝符号链接与越界文件；冻结路径始终相对工程根目录。"""
    path, root = Path(path), Path(root).resolve()
    if not path.is_absolute():
        path = root / path
    resolved = path.resolve()
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ValueError('冻结输入缺失或超出工程：' + str(path))
    cursor = root
    for part in path.relative_to(root).parts:
        cursor /= part
        if cursor.is_symlink():
            raise ValueError('冻结输入不得为符号链接：' + str(path))
    return resolved


def source_inputs(root=ROOT):
    """沿真实相对文件引用递归纳入测试数据、源GLB及代码依赖，不加入发行脚本。"""
    root = Path(root).resolve()
    paths = {project_file(path, root) for base in [
        'src', 'python/transwing_sim', 'python/tests', 'public', 'examples/python',
    ] for path in (root / base).rglob('*')
             if path.is_file() and '__pycache__' not in path.parts and path.suffix not in {'.pyc', '.pyo'}}
    paths.update(project_file(root / name, root) for name in [
        'package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json',
        'qa/flight-regression.test.ts', 'qa/glb-loader-check.mjs', 'qa/frontend/run.py',
    ])
    queue = list(paths)
    while queue:
        path = queue.pop()
        if path.suffix not in TEXT_SOURCE_SUFFIXES:
            continue
        for relative in re.findall(r'''["'](\.{1,2}/[^"'\n]+)["']''', path.read_text()):
            if '${' in relative or '?' in relative or '#' in relative:
                continue
            candidate = (path.parent / relative).resolve()
            choices = [candidate] + [Path(str(candidate) + suffix) for suffix in TEXT_SOURCE_SUFFIXES]
            if candidate.suffix in {'.js', '.mjs', '.jsx'}:
                choices.extend(candidate.with_suffix(suffix) for suffix in ['.ts', '.tsx', '.mts'])
            choices.extend(candidate / ('index' + suffix) for suffix in TEXT_SOURCE_SUFFIXES)
            for child in choices:
                if child.is_relative_to(root) and child.is_file() and 'node_modules' not in child.parts:
                    child = project_file(child, root)
                    if child not in paths:
                        paths.add(child)
                        queue.append(child)
                    break
    return paths


class EntryReferences(HTMLParser):
    """读取入口中浏览器会请求的资源，不把无关超链接变成构建依赖。"""
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


def distribution_references(path, data):
    """识别当前HTML、脚本和样式中的明确本地资源引用，跳过动态模板。"""
    suffix = PurePosixPath(path).suffix
    if suffix not in DIST_TEXT_SUFFIXES:
        return []
    text = data.decode('utf-8')
    if suffix == '.html':
        parser = EntryReferences()
        parser.feed(text)
        return parser.references
    if suffix == '.css':
        references = re.findall(r'''url\(\s*["']?([^"'\s)]+)["']?\s*\)''', text)
        references += re.findall(r'''@import\s*["']([^"']+)["']''', text)
    else:
        # 模块真实导入和打包器资产引用；不把未调用的库默认图片地址当作依赖。
        references = re.findall(r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']''', text)
        references += re.findall(r'''new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url''', text)
        references += re.findall(r'''["'`](/assets/[^"'`\s]+)["'`]''', text)
        references += ['/' + name for name in re.findall(r'''["'`](assets/[^"'`\s]+)["'`]''', text)]
    return [reference for reference in references if '${' not in reference
            and PurePosixPath(urlsplit(reference).path).suffix.lower() in DIST_ASSET_SUFFIXES]


def current_distribution(root=ROOT):
    """入口真实引用闭包与全部public副本；不扫描纳入历史未引用bundle。"""
    root = Path(root).resolve()
    names = {'dist/index.html'}
    for path in (root / 'public').rglob('*'):
        if path.is_file():
            source = project_file(path, root)
            relative = 'dist/' + path.relative_to(root / 'public').as_posix()
            destination = project_file(root / relative, root)
            if source.read_bytes() != destination.read_bytes():
                raise ValueError('静态源与当前构建副本不一致：' + relative)
            names.add(relative)
    queue = sorted(names)
    while queue:
        name = queue.pop()
        path = project_file(root / name, root)
        for reference in distribution_references(name, path.read_bytes()):
            url = urlsplit(reference)
            if url.scheme or url.netloc or not url.path:
                continue
            url_path = unquote(url.path)
            if '\\' in url_path or '\x00' in url_path:
                raise ValueError('构建资源引用含不安全路径：' + reference)
            target = ('dist/' + url_path.lstrip('/') if url_path.startswith('/') else
                      posixpath.normpath(posixpath.join(posixpath.dirname(name), url_path)))
            if not target.startswith('dist/'):
                raise ValueError('构建资源引用超出dist：' + reference)
            project_file(root / target, root)
            if target not in names:
                names.add(target)
                queue.append(target)
    return {project_file(root / name, root) for name in names}


def existing_dist_files(root=ROOT):
    root = Path(root).resolve()
    return {path.relative_to(root).as_posix() for path in (root / 'dist').rglob('*') if path.is_file()}


def main():
    os.chdir(ROOT)
    OUT.mkdir(parents=True, exist_ok=True)
    paths = source_inputs()
    before = {path.relative_to(ROOT).as_posix(): digest(path) for path in sorted(paths)}
    dist_before = existing_dist_files()
    commands = [
        ('unit', ['npm', 'test']),
        ('flight-loader', ['npm', 'run', 'test:qa']),
        ('format', ['npm', 'run', 'format:check']),
        ('build', ['npm', 'run', 'build']),
        ('python', ['.venv/bin/python', '-m', 'unittest', 'discover', '-s', 'python/tests', '-v']),
    ]
    stages = []
    for name, command in commands:
        env = os.environ.copy()
        env['PYTHONPATH'] = 'python'
        with (OUT / (name + '.log')).open('w') as log:
            try:
                result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, env=env)
                exit_code = result.returncode
            except OSError as error:
                log.write('阶段未能启动：' + str(error) + '\n')
                exit_code = -1
        stages.append({'name': name, 'exitCode': exit_code})
        print(name, exit_code, flush=True)

    changed = [name for name, old in before.items() if not (ROOT / name).is_file() or digest(ROOT / name) != old]
    dist_after = existing_dist_files()
    removed_dist = sorted(dist_before - dist_after)
    distribution_error = None
    distribution = set()
    try:
        distribution = current_distribution()
    except (OSError, ValueError) as error:
        distribution_error = str(error)
    paths.update(distribution)
    rows = [{'path': path.relative_to(ROOT).as_posix(), 'sha256': digest(path)}
            for path in sorted(paths) if path.is_file()]
    (OUT / 'input-lock.json').write_text(json.dumps({'files': rows}, indent=2) + '\n')
    current_names = {path.relative_to(ROOT).as_posix() for path in distribution}
    preservation = {
        'passed': not removed_dist, 'beforeCount': len(dist_before), 'afterCount': len(dist_after),
        'removedPaths': removed_dist, 'currentDistributionFiles': sorted(current_names),
        'retainedHistoricalPaths': sorted((dist_before & dist_after) - current_names),
        '说明': '允许更新同名文件，但不允许删除构建前已有文件；未引用旧包保留在目录中，不进入当前构建闭包。',
    }
    (OUT / 'build-preservation.json').write_text(json.dumps(preservation, ensure_ascii=False, indent=2) + '\n')
    summary = {
        'modelVersion': 24,
        'passed': all(stage['exitCode'] == 0 for stage in stages) and not changed
                  and not removed_dist and distribution_error is None,
        'inputStability': not changed, 'inputLockFiles': len(rows), 'stages': stages,
        'changedInputs': changed, 'nonDeletingBuild': not removed_dist,
        'buildPreservationPath': 'qa/frontend/build-preservation.json',
        'buildPreservationSha256': digest(OUT / 'build-preservation.json'),
        'currentDistributionFiles': len(distribution), 'distributionError': distribution_error,
        'runtimeSha256': digest(ROOT / 'public/models/xp4.glb'),
    }
    (OUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    raise SystemExit(0 if summary['passed'] else 1)


if __name__ == '__main__':
    main()
