# 🚀 Free LLM Gateway

> **Un solo endpoint. Siete proveedores. Cero costo.**

Router autoalojado que agrupa los free tiers de **7 proveedores** detrás de un único endpoint compatible con OpenAI.

## ✨ Características

- **OpenAI-compatible** — funciona con LangChain, CrewAI, AutoGen, OpenAI SDK, etc.
- **Streaming SSE** — token por token, como ChatGPT
- **Failover automático** — si un proveedor falla o está saturado, pasa al siguiente sin que el usuario lo note
- **7 proveedores, ~30M+ tokens/mes gratis** — sin tarjeta de crédito
- **Zero infraestructura** — un solo archivo, sin Docker, sin PostgreSQL
- **Dashboard** — `GET /` con métricas en tiempo real (auto-refresh 5s)
- **Health check** — `GET /health`
- **Metrics API** — `GET /metrics`

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
$env:GROQ_API_KEY="gsk_tu_key_groq"
$env:HF_API_KEY="hf_tu_key_hf"
npx tsx src/server.ts

# Linux/Mac
export GOOGLE_API_KEY="tu_key_google"
export CF_API_TOKEN="cfu_tu_token"
export CF_ACCOUNT_ID="tu_account_id"
export NVIDIA_API_KEY="nvapi_tu_key"
export COHERE_API_KEY="tu_key_cohere"
export ZAI_API_KEY="tu_key_zai"
export GROQ_API_KEY="gsk_tu_key_groq"
export HF_API_KEY="hf_tu_key_hf"
npx tsx src/server.ts   


📡 Endpoints
Método	Ruta			Descripción
POST	/v1/chat/completions	Chat (con stream: true para SSE)
GET	/			Dashboard (HTML, auto-refresh)
GET	/health			Provedores activos
GET	/metrics		Métricas por proveedor (JSON)



Chat
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hola"}]}'   


Streaming (SSE)
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hola"}],"stream":true}'   


🏗️ Arquitectura
Cliente (LangChain, OpenAI SDK, curl, ...)
        │
        ▼
  POST /v1/chat/completions
        │
        ▼
  ┌──────────────────────────┐
  │     Failover Router      │
  │  (stream + non-stream)   │
  └────────────┬─────────────┘
               │
  ┌────┬───────┼───────┬──────┬──────┬──────┐
  ▼    ▼       ▼       ▼      ▼      ▼      ▼
Google CF   NVIDIA Cohere  Z.ai  Groq  HuggingFace
(Gemini) (Llama) (Llama70B)(Cmd-R)(GLM)(GPT-OSS)(Llama70B)   


🔑 Obtener API Keys (todas gratis, sin tarjeta)
Proveedor		URL			Cuota			Modelo por defecto
Google AI Studio	aistudio.google.com	15 RPM / 500 RPD	gemini-3.5-flash-lite
Cloudflare Workers AI	dash.cloudflare.com	10,000 neurons/día	@cf/meta/llama-3.1-8b-instruct
NVIDIA NIM		build.nvidia.com	40 RPM / 10,000 RPD	meta/llama-3.3-70b-instruct
Cohere			dashboard.cohere.com	Trial (rate-limited)	command-r-08-2024
Z.ai (GLM)		z.ai			~1,000 RPD		glm-4.7-flash
Groq			console.groq.com	30 RPM / 1,000 RPD	openai/gpt-oss-120b
HuggingFace		huggingface.co		Rate-limited		meta-llama/Llama-3.3-70B-Instruct


📄 Licencia
MIT
