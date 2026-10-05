FROM python:3.14-slim
WORKDIR /app
COPY cloud/requirements.txt ./cloud/requirements.txt
RUN pip install --no-cache-dir -r cloud/requirements.txt
COPY cloud/ ./cloud/
COPY server.py gemini.py deepseek.py aicredits.py ./
COPY public/ ./public/
RUN useradd --uid 10001 --create-home orbit
USER orbit
ENV PYTHONUNBUFFERED=1
CMD ["sh", "-c", "exec gunicorn 'cloud.app:create_app()' --bind 0.0.0.0:${PORT:-10000} --workers 1 --threads 12 --timeout 180 --graceful-timeout 30 --worker-tmp-dir /tmp --error-logfile -"]
