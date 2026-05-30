# Watch response latency plan

## Step 1 - quick text card

Goal: after the user taps stop on Apple Watch, keep the stable m4a recorder and return a real AI one-screen text response as early as possible.

Scope:
- Watch uploads the stable m4a file.
- Server stores the audio, transcribes it, then runs a compact quick watchResponse pass.
- Watch shows only processing status while waiting; no fake word-cloud placeholder.
- Server continues full analysis in the background and updates the same record.
- Existing full-file upload remains the source of truth for storage and iPhone details.

Acceptance:
- Existing Action Button flow still works.
- Watch only uses the word-cloud poster for the real AI response.
- Watch never plays voice unless explicitly allowed by responseMode.

## Step 2 - latency instrumentation

Goal: every record exposes stage timing.

Metrics:
- upload_ms
- signed_url_ms
- transcription_ms
- quick_analysis_ms
- quick_upsert_ms
- quick_total_ms
- full_analysis_ms
- full_voice_ms
- full_upsert_ms
- full_total_ms

Next:
- Surface these timings in development logs/UI for real Watch recordings.
- Use the timings to decide whether optimization should target upload, transcription, or response generation.

## Step 3 - true streaming path

Goal: use a separate realtime audio path without replacing the stable recorder.

Metrics:
- watch_stream_connect_ms
- first_audio_chunk_ms
- first_transcript_delta_ms
- transcript_completed_ms
- realtime_watch_response_ms
- full_upload_ms
- full_transcription_ms
- full_analysis_ms
- total_ms

## Step 4 - explicit voice streaming

Goal: only when the user explicitly asks for voice, stream spoken response back to Watch.

Scope:
- LLM text streaming.
- TTS chunk streaming.
- Watch playback buffering.
- No default voice in prayer, turning, journal, or sensitive contexts.
