# 🚀 Free LLM Gateway

> **Un solo endpoint. Cinco proveedores. Cero costo.**

Router autoalojado que agrupa los free tiers de **Google AI Studio**, **Cloudflare Workers AI**, **NVIDIA NIM**, **Cohere** y **Z.ai (GLM)** detrás de un único endpoint compatible con OpenAI.

## ✨ Características

- **OpenAI-compatible** — funciona con LangChain, CrewAI, AutoGen, OpenAI SDK, etc.
- **Streaming SSE** — token por token, como ChatGPT
- **Failover automático** — si un proveedor falla o está saturado, pasa al siguiente sin que el usuario lo note
- **5 proveedores, ~20M+ tokens/mes gratis** — sin tarjeta de crédito
- **Zero infraestructura** — un solo archivo, sin Docker, sin PostgreSQL
- **Health check** — `GET /health` para verificar proveedores activos

## 🚀 Quick Start

```bash
npm install  



# Windows (PowerShell)
$env:GOOGLE_API_KEY="tu_key_google"
$env:CF_API_TOKEN="cfu_tu_token"
$env:CF_ACCOUNT_ID="tu_account_id"
$env:NVIDIA_API_KEY="nvapi_tu_key"
$env:COHERE_API_KEY="tu_key_cohere"
$env:ZAI_API_KEY="tu_key_zai"
npx tsx src/server.ts

# Linux/Mac
export GOOGLE_API_KEY="tu_key_google"
export CF_API_TOKEN="cfu_tu_token"
export CF_ACCOUNT_ID="tu_account_id"
export NVIDIA_API_KEY="nvapi_tu_key"
export COHERE_API_KEY="tu_key_cohere"
export ZAI_API_KEY="tu_key_zai"
npx tsx src/server.ts   


📡 Endpoint
Chat (sin streaming)

curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hola"}]}'   


Respuesta:

{
  "id": "chatcmpl-1794887991011",
  "object": "chat.completion",
  "model": "google",
  "provider": "google",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "¡Hola!" },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10 }
}   



Streaming (SSE)

curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hola"}],"stream":true}'   


Respuesta (token por token):

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"¡Ho"}}]}
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"la!"}}]}
data: [DONE]   


🩺 Health Check

curl http://localhost:3000/health
# → {"status":"ok","providers":["google","cloudflare","nvidia","cohere","zai"]}   


🏗️ Arquitectura

Cliente (LangChain, OpenAI SDK, curl, ...)
        │
        ▼
  POST /v1/chat/completions
        │
        ▼
  ┌─────────────────────────┐
  │    Failover Router      │
  │  (stream + non-stream)  │
  └────────────┬────────────┘
               │
   ┌───────┬───┴───┬──────────┬──────────┐
   ▼       ▼       ▼          ▼          ▼
 Google  Cloudflare NVIDIA   Cohere    Z.ai
(Gemini) (Llama)  (Llama70B) (Cmd-R)  (GLM-Flash)   



🔑 Obtener API Keys (todas gratis, sin tarjeta)

Proveedor		URL			Cuota			Modelo por defecto
Google AI Studio	aistudio.google.com	15 RPM / 500 RPD	gemini-3.5-flash-lite
Cloudflare Workers AI	dash.cloudflare.com	10,000 neurons/día	@cf/meta/llama-3.1-8b-instruct
NVIDIA NIM		build.nvidia.com	40 RPM / 10,000 RPD	meta/llama-3.3-70b-instruct
Cohere			dashboard.cohere.com	Trial (rate-limited)	command-r-08-2024
Z.ai (GLM)		z.ai			~1,000 RPD		glm-4.7-flash



📄 Licencia
MIT


`Ctrl+S`, cierra.

**Paso 2:**

```powershell
git add .
git commit -m "📝 Update README: 5 providers, streaming, architecture diagram"
git push   
 