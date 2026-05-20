# Face Recognition Model Storage

Store local face recognition model files here when running RemitSafe with server-side facial verification.

Recommended hackathon setup:

- Mobile/web: camera capture and user guidance only
- Server/API: face detection, embedding generation, and face matching
- Model: InsightFace `buffalo_l` for best backend accuracy
- Fallback model: InsightFace `buffalo_s` for faster or weaker server machines

Do not commit downloaded model weights to git. Large model files are ignored by `.gitignore`.

Expected local examples:

```text
models/face-recognition/
├── buffalo_l/
└── buffalo_s/
```

Use `FACE_MODEL_DIR=./models/face-recognition` in local environment files.
