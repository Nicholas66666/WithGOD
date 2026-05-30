# Deep Response Audio Fixtures

Phase 0 provider benchmarks expect raw PCM speech fixtures:

- 16 kHz sample rate
- mono
- signed 16-bit little-endian PCM
- no WAV header

Do not commit private prayer recordings. Keep real fixtures local or use temporary files under `/private/tmp`.

Example conversion from a local WAV file:

```bash
ffmpeg -i input.wav -ac 1 -ar 16000 -f s16le /private/tmp/deep-response-speech.pcm
```
