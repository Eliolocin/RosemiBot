FROM python:3.12-slim

# Pinned: a new release can change the rules and the report TomoriBot shows the reviewer.
RUN pip install --no-cache-dir "slop-guard==0.5.0"

COPY serve.py /app/serve.py

RUN useradd --system --no-create-home slopguard
USER slopguard

EXPOSE 8765
CMD ["python", "/app/serve.py"]
