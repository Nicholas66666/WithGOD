# Volcengine Provider Handoff

Last verified: 2026-05-29.

## Status

Volcengine / Doubao credentials and service resources are configured for the POC.

Fresh verification command:

```bash
node scripts/test-volcengine-provider.mjs
```

Latest result:

- Env consistency: `ARK_API_KEY`, `DOUBAO_SPEECH_APP_ID`, and `DOUBAO_SPEECH_ACCESS_TOKEN` match between `.env.local` and `supabase/.env.local`.
- Ark LLM actual chat completion: `PASS`, HTTP `200`.
- Doubao ASR WebSocket handshake: `PASS`, HTTP upgrade `101`.
- Doubao ASR init request: `PASS`, service returned JSON with `result`.
- Doubao TTS WebSocket handshake: `PASS`, HTTP upgrade `101`.
- Doubao TTS HTTP synthesis: `PASS`, HTTP `200`, service code `3000`, returned audio data.

Optional `DOUBAO_SPEECH_API_KEY` mode returned `401`; this is not used by the current POC path. The working path uses App ID + Access Token.

## Selected Provider Stack

Use a staged ASR -> LLM -> TTS cascade, not an end-to-end realtime speech model.

- ASR: Doubao streaming ASR, WebSocket endpoint `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`.
- ASR resource ID: `volc.bigasr.sauc.duration`.
- LLM: Ark OpenAI-compatible chat completions.
- LLM base URL: `https://ark.cn-beijing.volces.com/api/v3`.
- LLM primary model: `doubao-seed-2-0-lite-260215`.
- LLM fallback model: `doubao-seed-2-0-pro-260215`.
- TTS: Doubao big TTS resource `volc.service_type.10029`.
- TTS WebSocket endpoint: `wss://openspeech.bytedance.com/api/v3/tts/bidirection`.
- Initial TTS voice: `zh_male_shaonianzixin_moon_bigtts`.
- TTS HTTP endpoint verified for synthesis: `https://openspeech.bytedance.com/api/v1/tts`.

Important: Earlier candidate resources `volc.seedasr.sauc.duration` and `seed-tts-2.0` returned `403` for the current application. Do not use them in the first SPEC unless the account is later reconfigured and re-verified.

## Environment Files

The real secrets are in:

- `FocusFence/.env.local`
- `FocusFence/supabase/.env.local`

The committed templates are:

- `FocusFence/.env.example`
- `FocusFence/supabase/.env.example`

Required credential fields:

```bash
ARK_API_KEY=...
DOUBAO_SPEECH_APP_ID=...
DOUBAO_SPEECH_ACCESS_TOKEN=...
```

The POC should use these configured non-secret defaults:

```bash
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=doubao-seed-2-0-lite-260215
ARK_FALLBACK_MODEL=doubao-seed-2-0-pro-260215

DOUBAO_ASR_WS_URL=wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
DOUBAO_ASR_RESOURCE_ID=volc.bigasr.sauc.duration
DOUBAO_ASR_MODEL_NAME=bigmodel
DOUBAO_ASR_SAMPLE_RATE=16000
DOUBAO_ASR_AUDIO_FORMAT=pcm
DOUBAO_ASR_AUDIO_CODEC=raw
DOUBAO_ASR_AUDIO_BITS=16
DOUBAO_ASR_AUDIO_CHANNELS=1
DOUBAO_ASR_END_WINDOW_SIZE_MS=800

DOUBAO_TTS_WS_URL=wss://openspeech.bytedance.com/api/v3/tts/bidirection
DOUBAO_TTS_RESOURCE_ID=volc.service_type.10029
DOUBAO_TTS_MODEL=
DOUBAO_TTS_SPEAKER_ID=zh_male_shaonianzixin_moon_bigtts
DOUBAO_TTS_AUDIO_FORMAT=pcm
DOUBAO_TTS_SAMPLE_RATE=24000
DOUBAO_TTS_SPEECH_RATE=0
DOUBAO_TTS_LOUDNESS_RATE=0
```

## Implementation Notes For SPEC

The first implementation should keep provider boundaries explicit:

- `ASRProvider`: accepts 16 kHz mono PCM chunks, opens Doubao ASR WebSocket, sends init request, streams audio frames, emits transcript deltas/final text.
- `LLMProvider`: uses Ark chat completions with `stream: true`, emits text deltas.
- `TTSProvider`: uses Doubao TTS. For fastest verified implementation, HTTP synthesis is already proven. For realtime playback, implement WebSocket bidirectional TTS next using the same App ID + Access Token and `volc.service_type.10029`.
- `VoicePipeline`: orchestrates ASR -> LLM -> TTS and records timing.

Required timing fields:

- `asr_ws_connect_ms`
- `asr_init_ms`
- `first_transcript_delta_ms`
- `transcript_final_ms`
- `llm_first_token_ms`
- `tts_connect_ms`
- `tts_first_audio_ms`
- `first_playable_audio_ms`
- `voice_pipeline_total_ms`

Do not couple Apple Watch code directly to Volcengine. Watch should talk to our server protocol; server owns provider-specific auth, binary framing, retry, and diagnostics.

## Verification Boundaries

Verified now:

- Ark credential and model can produce a chat completion.
- Doubao ASR credentials/resource can complete WebSocket handshake and init request.
- Doubao TTS credentials/resource can complete WebSocket handshake.
- Doubao TTS credentials/resource can synthesize a short MP3 over HTTP.

Not yet verified in this handoff:

- ASR transcription of a real PCM speech fixture through the full binary audio frame protocol.
- TTS WebSocket audio chunk streaming beyond handshake.
- End-to-end Watch -> server -> ASR -> LLM -> TTS -> playback flow.

The SPEC should make those the first acceptance tests for implementation rather than assuming they already exist.

## Useful Files

- Provider setup details: `FocusFence/docs/volcengine-provider-setup.md`
- Diagnostic script: `FocusFence/scripts/test-volcengine-provider.mjs`
- Current realtime plan: `FocusFence/docs/realtime-watch-response-plan.md`
- Current Supabase function: `FocusFence/supabase/functions/presence-process/index.ts`
