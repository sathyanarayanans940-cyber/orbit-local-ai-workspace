"""Build the cloud repository from an explicit public-asset allowlist."""
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

root = Path(__file__).resolve().parent.parent
release = root / 'release'
release.mkdir(exist_ok=True)
assets = {'index.html'} | {s.split('?')[0] for s in re.findall(r"'\./([^']+)'", (root / 'service-worker.js').read_text())}
assets |= {str(p.relative_to(root)) for p in (root / 'vendor').rglob('*') if p.is_file() and not p.name.startswith('.')}
with tempfile.TemporaryDirectory(prefix='orbit-cloud-package-') as tmp:
    package = Path(tmp) / 'Orbit-Cloud'
    for name in sorted(assets):
        source, target = root / name, package / 'public' / name
        assert source.is_file() and not source.is_symlink()
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    for source in (root / 'cloud').rglob('*'):
        if source.is_file() and '__pycache__' not in source.parts and (source.suffix in ('.py', '.html', '.css', '.js', '.txt', '.md', '.yaml') or source.name == 'Dockerfile'):
            target = package / 'cloud' / source.relative_to(root / 'cloud')
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    shutil.copy2(root / 'server.py', package / 'server.py')
    shutil.copy2(root / 'gemini.py', package / 'gemini.py')
    shutil.copy2(root / 'openai_gateway.py', package / 'openai_gateway.py')
    shutil.copy2(root / 'deepseek.py', package / 'deepseek.py')
    shutil.copy2(root / 'aicredits.py', package / 'aicredits.py')
    shutil.copy2(root / 'cloud' / 'render.yaml', package / 'render.yaml')
    shutil.copy2(root / 'cloud' / 'README.md', package / 'README.md')
    (package / '.gitignore').write_text('.env\n.env.*\n*.pem\n*.key\n__pycache__/\n.DS_Store\n')
    (package / '.dockerignore').write_text('.git\n.env\n.env.*\n*.pem\n*.key\n**/__pycache__\n')
    output = release / 'Orbit-Cloud.zip'
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for item in sorted(package.rglob('*')):
            if item.is_file():
                archive.write(item, str(item.relative_to(package.parent)))
    destination = release / 'Orbit-Cloud'
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(package, destination)
    print(f'Cloud package: {output} ({output.stat().st_size:,} bytes)')

# A flat four-file repository is also supported for native browser uploaders.
# Render unpacks the audited source ZIP during the build; no personal workspace
# files or credentials are copied into the build context.
upload = release / 'Orbit-Cloud-Upload'
upload.mkdir(exist_ok=True)
shutil.copy2(output, upload / output.name)
(upload / 'Dockerfile').write_text('''FROM python:3.14-slim
COPY Orbit-Cloud.zip /tmp/Orbit-Cloud.zip
RUN python -m zipfile -e /tmp/Orbit-Cloud.zip /app && rm /tmp/Orbit-Cloud.zip
WORKDIR /app/Orbit-Cloud
RUN pip install --no-cache-dir -r cloud/requirements.txt && useradd --uid 10001 --create-home orbit
USER orbit
ENV PYTHONUNBUFFERED=1
CMD ["sh", "-c", "exec gunicorn 'cloud.app:create_app()' --bind 0.0.0.0:${PORT:-10000} --workers 1 --threads 12 --timeout 180 --graceful-timeout 30 --worker-tmp-dir /tmp --error-logfile -"]
''')
(upload / 'render.yaml').write_text((root / 'cloud/render.yaml').read_text().replace('./cloud/Dockerfile', './Dockerfile'))
(upload / 'README.md').write_text('''# Personal Orbit Cloud

This repository contains the tested source package in `Orbit-Cloud.zip`.
Keep the ZIP intact: Docker unpacks it during the build. It contains the full
readable source and deployment guide, with no API keys, chats or certificates.

On Render choose New → Blueprint and select this private repository.
Set OLLAMA_API_KEY and an ORBIT_PASSWORD of at least 8 characters privately
in Render. The Blueprint generates ORBIT_SESSION_SECRET automatically.
Render provides the HTTPS address and free trial instance.

Chats and memories stay in each browser; there is no cross-device sync yet.
Free services may take about a minute to wake after inactivity.
Never commit secrets to this repository. Update by replacing the source ZIP.
''')
print(f'Browser upload folder: {upload}')
