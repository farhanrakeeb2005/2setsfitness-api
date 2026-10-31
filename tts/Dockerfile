# 2SetsFitness coach voice: Kokoro af_heart over HTTP (server.py). Private
# Cloud Run service; see README.md. Build: gcloud run deploy tts --source tts
FROM python:3.12-slim AS model
# Kokoro v1.0 (Apache-2.0), sherpa-onnx's packaging, from the official k2-fsa
# release only; fp32 (it renders faster than the int8 build on 2 vCPUs)
ARG MODEL_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2
ARG MODEL_SHA256=60703707bc05ccd48d60e1eb723f38b07d6e474795a0b6a588d7220400e0f7a4
COPY fetch_model.py /tmp/fetch_model.py
RUN python /tmp/fetch_model.py "$MODEL_URL" "$MODEL_SHA256" /models/kokoro

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MODEL_DIR=/models/kokoro PORT=8080
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=model /models /models
COPY server.py .
# an unprivileged user
RUN useradd --system --uid 10001 tts
USER tts
EXPOSE 8080
CMD ["python", "server.py"]
