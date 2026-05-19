# LLM Provider Fallback Chain

## Propósito

Permitir cambiar de proveedor LLM (Groq → Gemini → futuro Claude/OpenAI) sin tocar `agent.ts` ni los capabilities. Soportar cadenas de fallback: si el primario falla con cualquier error (rate-limit, 5xx, timeout, JSON malformado), el secundario toma el turno.

## Componentes

| Pieza | Archivo |
|---|---|
| Interfaz `ILLMProvider` + tipos neutrales | `supabase/functions/voice-worker/providers/ILLMProvider.ts` |
| Provider Groq (con key rotation 429) | `voice-worker/providers/GroqProvider.ts` |
| Provider Gemini (via OpenAI-compat) | `voice-worker/providers/GeminiProvider.ts` |
| `FallbackChain` + registry | `voice-worker/providers/registry.ts` |

## Selección por env var

```bash
LLM_PROVIDER=groq               # solo Groq (default)
LLM_PROVIDER=gemini             # solo Gemini
LLM_PROVIDER=gemini,groq        # Gemini primario, Groq fallback
```

Cualquier proveedor desconocido lanza al inicializar:
```
Unknown LLM provider "xxx". Valid: groq, gemini
```

## Mensajes neutrales

`ChatRequest`/`ChatResponse` abstraen las diferencias de wire format. Cada provider traduce de/a la forma OpenAI-compat (ambos Groq y Gemini la aceptan en su endpoint `v1/chat/completions`).

```ts
interface ChatRequest {
  system:           string
  messages:         NeutralMessage[]    // {role, content, tool_calls?, tool_call_id?, name?}
  tools:            NeutralTool[]       // {name, description, parameters}
  temperature?:     number
  maxOutputTokens?: number
}

interface ChatResponse {
  content:    string | null
  toolCalls:  NeutralToolCall[]         // {id, name, arguments}
  tokensUsed: number
  modelUsed:  string                    // "groq/llama-3.3-70b-versatile" | "gemini/gemini-2.0-flash"
}
```

## GroqProvider

- **Primary**: `llama-3.3-70b-versatile`.
- **Fallback interno**: `llama-3.1-8b-instant` cuando el primario lanza.
- **Key rotation 429**: `LLM_API_KEY` puede ser CSV. Si una key choca 429, se prueba la siguiente sin propagar el error. Solo el 429 final propaga.
- **Settings**: `temperature=0.1`, `max_tokens=400`, `parallel_tool_calls=false` (previene doble booking).

## GeminiProvider

- Modelo default: `gemini-2.0-flash` (override por `GEMINI_MODEL`).
- Endpoint OpenAI-compat: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`.
- Acepta la misma forma de tools/messages que Groq → cero translation extra.

## FallbackChain

```ts
class FallbackChain implements ILLMProvider {
  async chat(req) {
    for (const provider of this.chain) {
      try { return await provider.chat(req) }
      catch (err) {
        const next = this.chain[i + 1]
        if (next) { warn(`${provider.name} failed, falling back to ${next.name}`); continue }
        throw err
      }
    }
  }
}
```

El `modelUsed` que se devuelve es el del provider que efectivamente respondió — útil para trazas (`ai_traces.llm_steps[].model`).

## Memoización por cold start

`getProvider()` cachea la instancia. El Edge runtime de Supabase reusa el isolate entre invocaciones cercanas, así que la cadena no se reconstruye en cada request.

## Cómo añadir un proveedor

1. Implementa `ILLMProvider` en `voice-worker/providers/<Name>Provider.ts`.
2. Añade `'<name>': () => new <Name>Provider()` en `PROVIDER_FACTORY` de `registry.ts`.
3. Despliega con `LLM_PROVIDER=<name>` o como parte de una cadena.
4. **No tocas `agent.ts`** ni capabilities.

## Tests

- `__tests__/edge-functions/voice-worker/providers/registry.test.ts` — selección + chain.
- `__tests__/edge-functions/voice-worker/providers/GroqProvider.test.ts` — translation + key rotation.
- `__tests__/edge-functions/voice-worker/providers/GeminiProvider.test.ts` — translation + endpoint.
