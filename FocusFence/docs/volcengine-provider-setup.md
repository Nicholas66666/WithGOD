# Volcengine Provider Setup

Last checked: 2026-06-05.

## Target POC Stack

Use one Volcengine account and keep the first implementation deterministic:

- ASR: Doubao streaming ASR hourly SKU currently enabled on this account, `volc.bigasr.sauc.duration`.
- LLM: Ark character model selected by DeepResponse benchmark, `doubao-seed-character-251128`.
- LLM fallback: none configured by default. The earlier Seed 2.0 Pro fallback failed realtime latency gates.
- TTS: Doubao big TTS currently enabled on this account, `volc.service_type.10029`.

Do not start with the end-to-end realtime speech model. The current project needs an observable ASR -> LLM -> TTS cascade so each stage can be measured and swapped independently.

## Official Current Model Notes

### ASR

Open in the Doubao Speech console:

- Product entry: <https://console.volcengine.com/speech/app>
- Model docs: <https://www.volcengine.com/docs/6561/2499930?lang=zh>
- API docs: <https://www.volcengine.com/docs/6561/1354869?lang=zh>

Select:

- `豆包流式语音识别模型2.0`
- `小时版`
- Resource ID: `volc.bigasr.sauc.duration`
- WebSocket URL: `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`

Use the optimized bidirectional streaming endpoint first. It returns only when recognition changes, reducing unnecessary packets and improving realtime latency.

Required credentials:

- `DOUBAO_SPEECH_APP_ID`: speech application App ID.
- `DOUBAO_SPEECH_ACCESS_TOKEN`: speech application Access Token.

Request headers:

- `X-Api-App-Key: DOUBAO_SPEECH_APP_ID`
- `X-Api-Access-Key: DOUBAO_SPEECH_ACCESS_TOKEN`
- `X-Api-Resource-Id: DOUBAO_ASR_RESOURCE_ID`
- `X-Api-Connect-Id` or `X-Api-Request-Id`: generated UUID per connection/request. Log it for vendor support.

Recommended request values:

- `model_name`: `bigmodel`
- `format`: `pcm`
- `codec`: `raw`
- `rate`: `16000`
- `bits`: `16`
- `channel`: `1`
- `enable_itn`: `true`
- `enable_punc`: `true`
- `end_window_size`: `800`

Environment mapping:

- `DOUBAO_ASR_WS_URL` -> WebSocket URL.
- `DOUBAO_ASR_RESOURCE_ID` -> request header `X-Api-Resource-Id`.
- `DOUBAO_ASR_MODEL_NAME` -> full client request JSON `request.model_name`.
- `DOUBAO_ASR_AUDIO_FORMAT` -> full client request JSON `audio.format`.
- `DOUBAO_ASR_AUDIO_CODEC` -> full client request JSON `audio.codec`.
- `DOUBAO_ASR_SAMPLE_RATE` -> full client request JSON `audio.rate`.
- `DOUBAO_ASR_AUDIO_BITS` -> full client request JSON `audio.bits`.
- `DOUBAO_ASR_AUDIO_CHANNELS` -> full client request JSON `audio.channel`.
- `DOUBAO_ASR_END_WINDOW_SIZE_MS` -> full client request JSON `request.end_window_size`.

### LLM

Open in the Ark console:

- Product entry: <https://console.volcengine.com/ark/>
- API Key: <https://console.volcengine.com/ark/region:ark+cn-beijing/apikey>
- Model list: <https://www.volcengine.com/docs/82379/1554680>
- Quick start: <https://www.volcengine.com/docs/82379/1399008>
- Streaming output: <https://www.volcengine.com/docs/82379/2123275>

Select and enable in Ark `开通管理`:

- Primary: `doubao-seed-character-251128`
- Fallback: leave unset until a second model passes the DeepResponse LLM benchmark gates.

Use:

- Base URL: `https://ark.cn-beijing.volces.com/api/v3`
- Auth: `Authorization: Bearer $ARK_API_KEY`
- Streaming: `stream: true`

For the Watch response path, default to the benchmark-selected character model because first-token and first-phrase latency matter more than deep reasoning. The earlier Seed 2.0 Lite/Pro candidates were rejected by `docs/deep-response-llm-benchmark-results.md` for realtime latency.

### TTS

Open in the Doubao Speech console:

- Product entry: <https://console.volcengine.com/speech/app>
- TTS V3 API list/docs: <https://www.volcengine.com/docs/6561/1598757>
- TTS V3 bidirectional docs: <https://www.volcengine.com/docs/6561/1329505?lang=zh>
- Historical V1 HTTP docs: <https://www.volcengine.com/docs/6561/1257584?lang=zh>
- Model docs: <https://www.volcengine.com/docs/6561/2499930?lang=zh>

Select:

- `语音合成大模型`
- Resource ID: `volc.service_type.10029`
- WebSocket URL: `wss://openspeech.bytedance.com/api/v3/tts/bidirection`

The account screenshots show `BigTTS...` instances and enabled `*_moon_bigtts` voices. The diagnostic script confirmed `volc.service_type.10029` returns WebSocket 101, while `seed-tts-2.0` returns 403 for this application. Use the enabled resource first.

Required credentials:

- `DOUBAO_SPEECH_APP_ID` and `DOUBAO_SPEECH_ACCESS_TOKEN`: use the same pair as ASR.
- Optional TTS-only new console mode: `DOUBAO_SPEECH_API_KEY`.

Request headers:

- Default POC mode: `X-Api-App-Key: DOUBAO_SPEECH_APP_ID`
- Default POC mode: `X-Api-Access-Key: DOUBAO_SPEECH_ACCESS_TOKEN`
- Optional TTS-only new console mode: `X-Api-Key: DOUBAO_SPEECH_API_KEY`
- `X-Api-Resource-Id: DOUBAO_TTS_RESOURCE_ID`
- `X-Api-Connect-Id` or `X-Api-Request-Id`: generated UUID per connection/request. Log it for vendor support.

V3 request body mapping:

- `namespace`: `BidirectionalTTS`
- `DOUBAO_TTS_MODEL` -> leave empty for the currently enabled `volc.service_type.10029` path unless a later implementation explicitly requires `req_params.model`.
- `DOUBAO_TTS_SPEAKER_ID` -> `req_params.speaker`
- `DOUBAO_TTS_AUDIO_FORMAT` -> `req_params.audio_params.format`
- `DOUBAO_TTS_SAMPLE_RATE` -> `req_params.audio_params.sample_rate`
- `DOUBAO_TTS_SPEECH_RATE` -> `req_params.audio_params.speech_rate`
- `DOUBAO_TTS_LOUDNESS_RATE` -> `req_params.audio_params.loudness_rate`

Recommended voice:

- `zh_male_shaonianzixin_moon_bigtts`

Confirm the speaker appears as enabled in the console before using it. If unavailable, pick another enabled `*_moon_bigtts` speaker from the `Voice_type` column and update `DOUBAO_TTS_SPEAKER_ID`.

## Console Steps

### 1. Ark LLM

1. Go to <https://console.volcengine.com/ark/>.
2. If first use, click `开通服务`.
3. Open `API Key 管理`.
4. Create an API Key and copy it into `ARK_API_KEY`.
5. Open `开通管理`.
6. Search or filter for `doubao-seed-character-251128`.
7. Enable `doubao-seed-character-251128`.
8. Leave `ARK_FALLBACK_MODEL` unset unless a later benchmark selects a fallback.

### 2. Doubao Streaming ASR

1. Go to <https://console.volcengine.com/speech/app>.
2. Create or open a speech application.
3. In the model/product list, choose `豆包流式语音识别模型2.0`.
4. Click `立即使用` if shown.
5. Choose `小时版` rather than `并发版`.
6. Confirm resource ID `volc.bigasr.sauc.duration` for the currently enabled account resource.
7. Copy the application App ID to `DOUBAO_SPEECH_APP_ID`.
8. Copy the application Access Token to `DOUBAO_SPEECH_ACCESS_TOKEN`.

### 3. Doubao TTS 2.0

1. Stay in <https://console.volcengine.com/speech/app>.
2. Open the same speech application, or create one dedicated to this POC.
3. Choose `豆包语音合成大模型2.0`.
4. Click `立即使用` if shown.
5. Confirm resource ID `volc.service_type.10029`.
6. Select and enable a `*_moon_bigtts` speaker.
8. Put the selected speaker ID in `DOUBAO_TTS_SPEAKER_ID`.

## Billing Decision

For POC:

- Use account balance / pay-as-you-go first.
- Recharge a small balance, for example 100-300 CNY.
- Do not buy concurrency packages yet.
- Do not buy large yearly resource packages yet.
- Do not buy voice cloning or custom voice packages yet.

Why:

- Doubao Speech supports free trial quota after creating an application, then consumes prepaid packages before postpaid balance.
- Postpaid speech bills are hourly and can lag by several hours, so the account should keep a positive balance.
- ASR 2.0 hourly SKU supports both prepaid resource packages and postpaid usage.
- TTS 2.0 is billed by synthesized characters.
- We need real Watch recordings to estimate daily ASR hours and TTS characters before buying resource packages.

Revisit resource packages after the POC has:

- Average recording seconds per turn.
- Average response characters per spoken reply.
- Expected daily turns.
- Peak concurrent sessions.

## Files To Fill

Local scripts:

- Fill `FocusFence/.env.local`.
- Start from `FocusFence/.env.example`.

Supabase Edge Function deploy:

- Fill `FocusFence/supabase/.env.local`.
- Start from `FocusFence/supabase/.env.example`.

Do not paste real keys into committed files.

## Environment Variables

```bash
ARK_API_KEY=ark_YOUR_API_KEY
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=doubao-seed-character-251128
ARK_FALLBACK_MODEL=

DOUBAO_SPEECH_APP_ID=YOUR_DOUBAO_SPEECH_APP_ID
DOUBAO_SPEECH_ACCESS_TOKEN=YOUR_DOUBAO_SPEECH_ACCESS_TOKEN
DOUBAO_SPEECH_API_KEY=
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
