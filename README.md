# 🚀 Free LLM Gateway

> **Un solo endpoint. Tres proveedores. Cero costo.**

Router autoalojado que agrupa los free tiers de **Google AI Studio**, **Cloudflare Workers AI** y **NVIDIA NIM** detrás de un único endpoint compatible con OpenAI.

## ✨ Características

- **OpenAI-compatible** — funciona con LangChain, CrewAI, AutoGen, OpenAI SDK, etc.
- **Failover automático** — si un proveedor falla o está saturado, pasa al siguiente sin que el usuario lo note.
- **3 proveedores, ~15M+ tokens/mes gratis** — sin tarjeta de crédito.
- **Zero infraestructura** — un solo archivo, SQLite opcional, sin Docker.
- **Health check** — `GET /health` para verificar proveedores activos.

## 🚀 Quick Start

```bash
npm install   