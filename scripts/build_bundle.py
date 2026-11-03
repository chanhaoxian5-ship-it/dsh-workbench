"""Pack reviewed backend/frontend sources; never copy data, credentials or experiments."""
import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

SUITE = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--source-root', type=Path)
args = parser.parse_args()
candidate = SUITE.parents[1] / 'src/workbench'
source = args.source_root / 'src/workbench' if args.source_root else candidate
destination = SUITE / 'backend/workbench'
if not source.is_dir():
    source = destination
if not source.is_dir():
    raise SystemExit('Backend source is missing; provide --source-root.')
destination.mkdir(parents=True, exist_ok=True)
if source.resolve() != destination.resolve():
    for file in source.glob('*.py'):
        shutil.copy2(file, destination / file.name)
    shutil.copytree(source / 'web', destination / 'web', dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
for addon in (SUITE / 'python/workbench').glob('*.py'):
    shutil.copy2(addon, destination / addon.name)
shutil.copy2(SUITE / 'lib/launch.js', destination / 'web/launch.js')
index = destination / 'web/index.html'
markup = index.read_text(encoding='utf-8')
if 'src="/launch.js"' not in markup:
    markup = markup.replace('</body>', '<script type="module" src="/launch.js"></script>\n</body>')
index.write_text(markup, encoding='utf-8')
sys.path.insert(0, str(SUITE / 'backend'))
from workbench.agent import TOOLS
(SUITE / 'lib/tools.json').write_text(json.dumps(TOOLS, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
if candidate.is_dir():
    api = SUITE / 'docs/api'
    api.mkdir(parents=True, exist_ok=True)
    for name in ['后端V0接口与运行.md', '项目模块V1接口与运行.md', '阶段与里程碑V1接口与运行.md', '重要变化V0接口与运行.md', '项目凭证与浏览器登录.md']:
        text = (SUITE.parents[1] / 'docs/api' / name).read_text(encoding='utf-8')
        text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', lambda m: m[1]+'（原工程历史记录）'
                      if m[2].startswith('../') or m[2]=='前端V0使用与验证.md' else m[0], text)
        note = '> 随包HTTP契约参考。运行本插件以[安装说明](../INSTALL.md)为准：使用scripts/service.ps1，自动高位端口与独立dataDir。下文原工程启动命令和历史验证叙述不代表插件已在日常DSH安装；不执行其中旧的start-backend.ps1或8765默认值。\n\n'
        (api / name).write_text(note + text, encoding='utf-8')
    for name in ['publish-v1.example.json', 'project-v1.examples.json']:
        shutil.copy2(SUITE.parents[1] / 'docs/api' / name, api / name)
    # Ship the existing regression sources in Git, without their runtime data.
    for file in (SUITE.parents[1] / 'tests').glob('test_*.py'):
        text = file.read_text(encoding='utf-8').replace(' / "src"', ' / "backend"')
        (SUITE / 'tests' / file.name).write_text(text, encoding='utf-8')
    for name in ['publish-project.ps1', 'publish-discovery.ps1', 'maintain-backend.ps1', 'test-backend.ps1']:
        text = (SUITE.parents[1] / 'scripts' / name).read_text(encoding='utf-8').replace("'src'", "'backend'")
        (SUITE / 'scripts' / name).write_text(text, encoding='utf-8')
files = [p for folder in ('backend', 'python', 'lib', 'assets', 'locale') for p in (SUITE / folder).rglob('*')
         if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc']
for file in files:
    if file.suffix in ('.py', '.js', '.mjs', '.svg', '.html', '.css', '.json', '.md'):
        raw = file.read_bytes()
        normalized = raw.replace(b'\r\n', b'\n').rstrip(b'\n') + b'\n'
        if normalized != raw:
            file.write_bytes(normalized)
manifest = {'version': '0.3.0', 'backend_schema': 3, 'http_schema': 1,
            'files': {p.relative_to(SUITE).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}}
(SUITE / 'bundle-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
print(f'Bundled {len(files)} source files; no runtime data copied.')
