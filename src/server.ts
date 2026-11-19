import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
const CF_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT = process.env.CF_ACCOUNT_ID;
const NVIDIA_KEY = process.env.NVIDIA_API_KEY;
const PORT = 3000;

interface Provider {
  name: string;
  call: (messages: any[], model?: string, opts?: any) => Promise<{ text: string; usage?: any }>;
}

const providers: Provider[] = [];

if (GOOGLE_KEY) {
  providers.push({
    name: "google",
    async call(messages, model, opts) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-3.5-flash-lite"}:generateContent?key=${GOOGLE_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: messages.map((m: any) => ({
              role: m.role === "user" ? "user" : "model",
              parts: [{ text: m.content }],
            })),
            generationConfig: {
              ...(opts?.temperature !== undefined && { temperature: opts.temperature }),
              ...(opts?.max_tokens !== undefined && { maxOutputTokens: opts.max_tokens }),
            },
          }),
        }
      );
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      return {
        text: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
        usage: data.usageMetadata
          ? { prompt_tokens: data.usageMetadata.promptTokenCount, completion_tokens: data.usageMetadata.candidatesTokenCount, total_tokens: data.usageMetadata.totalTokenCount }
          : undefined,
      };
    },
  });
}

if (CF_TOKEN && CF_ACCOUNT) {
  providers.push({
    name: "cloudflare",
    async call(messages, model, opts) {
      const resp = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CF_TOKEN}`,
          },
          body: JSON.stringify({
            model: model || "@cf/meta/llama-3.1-8b-instruct",
            messages,
            ...(opts?.temperature !== undefined && { temperature: opts.temperature }),
            ...(opts?.max_tokens !== undefined && { max_tokens: opts.max_tokens }),
          }),
        }
      );
      const data = await resp.json();
      if (data.success === false) throw new Error(data.errors?.[0]?.message || "Cloudflare error");
      return {
        text: data.choices?.[0]?.message?.content || "",
        usage: data.usage
          ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens }
          : undefined,
      };
    },
  });
}

if (NVIDIA_KEY) {
  providers.push({
    name: "nvidia",
    async call(messages, model, opts) {
      const resp = await fetch(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${NVIDIA_KEY}`,
          },
          body: JSON.stringify({
            model: model || "meta/llama-3.3-70b-instruct",
            messages,
            ...(opts?.temperature !== undefined && { temperature: opts.temperature }),
            ...(opts?.max_tokens !== undefined && { max_tokens: opts.max_tokens }),
          }),
        }
      );
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      return {
        text: data.choices?.[0]?.message?.content || "",
        usage: data.usage
          ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens }
          : undefined,
      };
    },
  });
}

app.post("/v1/chat/completions", async (req, res) => {
  const { messages, model, temperature, max_tokens } = req.body;

  if (providers.length === 0) {
    return res.status(500).json({ error: "No hay proveedores configurados." });
  }

  const errors: string[] = [];

  for (const p of providers) {
    try {
      const result = await p.call(messages, model, { temperature, max_tokens });
      return res.json({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model || p.name,
        provider: p.name,
        choices: [{ index: 0, message: { role: "assistant", content: result.text }, finish_reason: "stop" }],
        usage: result.usage,
      });
    } catch (err: any) {
      errors.push(`${p.name}: ${err.message}`);
      continue;
    }
  }

  res.status(502).json({ error: "Todos los proveedores fallaron", details: errors });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", providers: providers.map(p => p.name) });
});

app.listen(PORT, () => {
  console.log(`🚀 Free LLM Gateway corriendo en http://localhost:${PORT}`);
  console.log(`   Provedores: ${providers.map(p => p.name).join(", ") || "NINGUNO"}`);
  console.log(`   POST /v1/chat/completions`);
  console.log(`   GET  /health`);
});
