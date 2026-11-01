"""2SetsFitness coach voice: Kokoro (af_heart) text-to-speech over HTTP.

POST /synth  {"text": "...", "voice": "af_heart", "speed": 1.0, "lang": "en-us"}
  -> 200 audio/mpeg (mono, 22.05 kHz, 48 kb/s), header X-Audio-Duration: seconds
  -> 400 {"error": "..."} for bad input
GET /healthz -> 200 ok

Private Cloud Run service: Cloud Run's IAM check (--no-allow-unauthenticated)
lets only the API's service account in, so this code does no auth itself.
Standard library HTTP server + sherpa-onnx (the model is loaded once at start)
+ lameenc for the MP3. See README.md.
"""
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import lameenc
import numpy as np
import sherpa_onnx

MODEL_DIR = os.environ.get("MODEL_DIR", "/models/kokoro")
MAX_CHARS = 600
MAX_BODY = 16 * 1024
OUT_RATE = 22050
BITRATE_KBPS = 48
# voice -> (speaker id in kokoro-multi-lang-v1_0's voices.bin, espeak language)
VOICES = {"af_heart": (3, "en-us"), "am_santa": (19, "en-us")}
# the coach is a yeti: a big, jolly voice (af_heart stays available)
DEFAULT_VOICE = "am_santa"


def validate(body):
    """The request body (a dict) -> (text, voice, speed) or raises ValueError."""
    if not isinstance(body, dict):
        raise ValueError("body must be a JSON object")
    text = body.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("text is required")
    text = " ".join(text.split())
    if len(text) > MAX_CHARS:
        raise ValueError(f"text is longer than {MAX_CHARS} characters")
    voice = body.get("voice") or DEFAULT_VOICE
    if voice not in VOICES:
        raise ValueError("unknown voice")
    lang = body.get("lang") or VOICES[voice][1]
    if lang != VOICES[voice][1]:
        raise ValueError("unsupported lang for this voice")
    speed = body.get("speed", 1.0)
    if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not 0.5 <= speed <= 2.0:
        raise ValueError("speed must be between 0.5 and 2.0")
    return text, voice, float(speed)


def load_tts():
    d = MODEL_DIR
    model = os.path.join(d, "model.int8.onnx")
    if not os.path.exists(model):
        model = os.path.join(d, "model.onnx")
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=model,
                voices=os.path.join(d, "voices.bin"),
                tokens=os.path.join(d, "tokens.txt"),
                data_dir=os.path.join(d, "espeak-ng-data"),
                lexicon=os.path.join(d, "lexicon-us-en.txt"),
                lang="en-us",
            ),
            num_threads=int(os.environ.get("TTS_THREADS", "2")),
        ),
        max_num_sentences=1,
    )
    if not cfg.validate():
        raise RuntimeError(f"bad model config (MODEL_DIR={d})")
    return sherpa_onnx.OfflineTts(cfg)


def to_mp3(samples, rate):
    pcm = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2").tobytes()
    enc = lameenc.Encoder()
    enc.set_channels(1)
    enc.set_in_sample_rate(rate)
    enc.set_out_sample_rate(OUT_RATE)
    enc.set_bit_rate(BITRATE_KBPS)
    enc.set_quality(2)
    return bytes(enc.encode(pcm) + enc.flush())


TTS = None
# one synthesis at a time per instance (the model already uses TTS_THREADS
# cores); Cloud Run's --concurrency queues the rest
LOCK = threading.Lock()


def synth(text, voice, speed):
    sid = VOICES[voice][0]
    with LOCK:
        audio = TTS.generate(text, sid=sid, speed=speed)
    samples = audio.samples
    if len(samples) == 0:
        raise RuntimeError("empty audio")
    return to_mp3(samples, audio.sample_rate), len(samples) / audio.sample_rate


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "tts"
    sys_version = ""

    def _send(self, code, body, ctype="application/json", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode())

    def do_GET(self):
        if self.path == "/healthz":
            return self._send(200, b"ok", "text/plain")
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/synth":
            return self._json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if n <= 0 or n > MAX_BODY:
            return self._json(400, {"error": "bad body size"})
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8"))
            text, voice, speed = validate(body)
        except (ValueError, UnicodeDecodeError) as e:
            return self._json(400, {"error": str(e) if isinstance(e, ValueError) else "bad body"})
        t = time.time()
        try:
            mp3, dur = synth(text, voice, speed)
        except Exception as e:  # noqa: BLE001 - logged, never sent back
            print(f"synth failed: {e}", file=sys.stderr, flush=True)
            return self._json(500, {"error": "synthesis failed"})
        print(json.dumps({"chars": len(text), "dur": round(dur, 2), "ms": int((time.time() - t) * 1000),
                          "bytes": len(mp3)}), flush=True)
        self._send(200, mp3, "audio/mpeg", {"X-Audio-Duration": f"{dur:.2f}"})

    def log_message(self, fmt, *args):  # the JSON line above is the request log
        pass


def main():
    global TTS
    t = time.time()
    TTS = load_tts()
    # first inference is slower (graph warm-up): do it before taking traffic
    TTS.generate("Ready.", sid=VOICES[DEFAULT_VOICE][0], speed=1.0)
    print(f"model loaded in {time.time() - t:.1f}s", flush=True)
    port = int(os.environ.get("PORT", "8080"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
