"""Build an allowlisted end-user distribution without local credentials or test data."""
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

root = Path(__file__).resolve().parent.parent
release = root / 'release'
release.mkdir(exist_ok=True)
files = '''file-preview.js archives.js document-assets.js document-edits.js workspace-core.js workspace-budget.js document-history.js workspace-tools.js long-documents.js boot.js analyze-sandbox.html analyze.js analyze-worker.js chat-store.js memories.js app.js voice.js usage.js charts.js widgets.js web-tools.js thinking.js widgets-ui.js icon.svg index.html
scripts/setup-analyze.py manifest.webmanifest server.py gemini.py deepseek.py aicredits.py orbit-dns.py service-worker.js styles.css
install-macos.command install-macos.sh install-windows.cmd install-windows.ps1
orbit-ollama-start-macos.sh orbit-start-windows.ps1 orbit-watchdog-windows.ps1'''.split()
files += [str(p.relative_to(root)) for p in sorted((root / 'vendor').rglob('*')) if p.is_file() and not p.name.startswith('.')]
with tempfile.TemporaryDirectory(prefix='orbit-package-') as temporary:
    package = Path(temporary) / 'Orbit'
    package.mkdir()
    for name in files:
        source = root / name
        if source.is_symlink() or source.suffix == '.pem':
            raise ValueError(f'Unexpected release asset: {name}')
        target = package / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    for name in ['install-macos.command', 'install-macos.sh', 'orbit-ollama-start-macos.sh']:
        (package / name).chmod(0o755)
    shutil.copyfile(root / 'scripts' / 'release-README.txt', package / 'START HERE.txt')
    # Verify every offline asset and both installers' explicit payloads.
    sw = (package / 'service-worker.js').read_text()
    required = [s.split('?')[0] for s in re.findall(r"'\./([^']+)'", sw)]
    mac = (package / 'install-macos.sh').read_text().split('ASSETS=(', 1)[1].split(')', 1)[0]
    required += mac.split()
    windows = (package / 'install-windows.ps1').read_text().split('$assets = @(', 1)[1].split(')', 1)[0]
    required += re.findall(r"'([^']+)'", windows)
    for name in required:
        assert (package / name).is_file(), f'Missing packaged dependency: {name}'
    output = release / 'Orbit.zip'
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for item in sorted(package.rglob('*')):
            if item.is_file():
                archive.write(item, str(item.relative_to(package.parent)))
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert not any(n.endswith('.pem') or '/node_modules/' in n or '/tests/' in n or '.DS_Store' in n for n in archive.namelist())
    # Replace only this script's generated distribution, never the working app.
    destination = release / 'Orbit'
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(package, destination)
    print(f'{len(files) + 1} files; ZIP {output.stat().st_size:,} bytes\n{output}')
