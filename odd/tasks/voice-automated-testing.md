# Voice assistant: automated end-to-end testing, post-deploy check and alerting
Objective: the dashboard voice assistant is proven automatically (real audio → browser recorder → voice-worker → Deepgram → agent), not by the owner testing by hand. Branch: `develop` (merges to `main` --no-ff). Delivery: ask-on-risk. Test runner: Playwright (E2E), Vitest (unit), `tsx` scripts.
Engram mirror: pending — the Engram tools are not available in this session.

## Specs
- S1 (opción 1): "E2E de voz real con Playwright". Chromium with a fake microphone that plays a recorded WAV question. The test taps the FAB, records, and checks the voice-worker answer: HTTP 200 and a transcription with the expected word. It repeats 4–5 turns and includes tapping while the answer is playing ("justo el caso que hoy falló en el tercer turno"). It does not compare the answer text (the LLM varies). It must be runnable by the agent on this machine and, in CI, as a job on pushes to `develop`/`main`.
- S2 (opción 2): "Chequeo sintético después de cada deploy (servidor)". A script like `scripts/trigger-voice.ts` that sends real WebM audio to the deployed `voice-worker`, run after the `deploy-functions` workflow and once a day. It detects an expired Deepgram key or a broken deploy.
- S3 (opción 3): "Alertas, para lo que se escape a las pruebas". A Sentry rule for client voice errors (the issue `JAVASCRIPT-NEXTJS-1M` accumulated 44 events in 5 months without anyone noticing).
- Assumption (agent, to confirm in review): S1 and S2 run against production Supabase with the E2E fixture user (the existing `e2e-full` job already does this), so they write `ai_traces` rows only for the fixture business.

## Tasks
| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T0 | prerequisite: recorder race fix + early-exit traces (validated by S1) | inline | done | af82d41 |
| T1 | S1 | inline | code done; 4/4 green pending the voice-worker deploy (turn 3 hit the Deepgram HTTP/2 reset) | e3e5e48 (+ retry 732071f) |
| T2 | S2 | inline | done — `check:voice` green against prod | (next commit) |
| T3 | S3 | inline | pending | |

## Log
- L1 (2026-10-23, user, verbatim): "como hacemos para que todo eso sea probado por ti o de que otra manera para que sea probado automaticamente?"
- L2 (2026-10-23, user, verbatim, after the agent proposed options 1–3): "1 , 2 y 3 en orden"
- L3 (2026-10-23): T0 committed as af82d41. Independent verifier: S1–S5 PASS, 13 race probes fail at HEAD and pass with the fix. The prod 400s came from orphaned MediaRecorders interleaving header-less chunks into a shared buffer (see INDEX Historial 2026-10-23).
- L4 (2026-10-23): existing coverage: `tests/e2e/voice-assistant.spec.ts` (VA1–VA6) only checks that the FAB is visible and does not crash, and runs only in the manual `e2e-full` job. ffmpeg is available locally for fixture generation. The default fixture email `test-e2e@cronix.com` does not exist in prod; `.env.local` defines `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` (existence in prod still to be checked).
- L5 (2026-10-23): the `E2E_TEST_EMAIL` user from `.env.local` exists in prod with a business (1 client) and signs in. Fixtures generated with Deepgram TTS `aura-2-nestor-es` (the payload must be sent as UTF-8; Git Bash mangled the accents) and ffmpeg: WAV 16 kHz 4.3 s, WebM/Opus 12 KB with an EBML header.
- L6 (2026-10-23): local runs. (1) Port 3000 was taken by another app, so Playwright reused it and the login landed on a foreign page → run with `PORT=3100`. (2) `postDataBuffer()` is null for multipart with files → dropped the header assertion; a corrupt upload surfaces as a 400 anyway. (3) Turn 3 failed twice with intact audio: Deepgram HTTP/2 reset in the edge runtime → retry added (732071f). It does not reproduce from local Deno (8/8 OK), so it is validated after the deploy. (4) Keyword boost turned "citas" into "E2E" → transcription checked as 2 of 4 words (`fixtures/voice/question.ts`).
- L7 (2026-10-23): `check:voice` → 200, transcription "¿Qué E2E luego hoy?", non-empty reply → pass. `DEEPGRAM_AURA_API_KEY` is not a GitHub secret yet (needed by the `E2E Voice` job).
- Next: user deploys `voice-worker` and adds the secret → rerun the `voice` E2E locally (expect 4/4) → push develop + main → T3 (Sentry alert for client voice errors).
