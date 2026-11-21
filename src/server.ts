import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
const CF_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT = process.env.CF_ACCOUNT_ID;
const NVIDIA_KEY = process.env.NVIDIA_API_KEY;
const COHERE_KEY = process.env.COHERE_API_KEY;   
const PORT = 3000;

interface Provider {
  name: string;
  call: (messages: any[], model?: string, opts?: any) => Promise<{ text: string; usage?: any }>;
  stream: (messages: any[], model?: string, opts?: any, res?: any) => Promise<void>;
}

const providers: Provider[] = [];

// --- Google AI Studio ---
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
    async stream(messages, model, opts, res) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-3.5-flash-lite"}:streamGenerateContent?alt=sse&key=${GOOGLE_KEY}`,
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
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const json = JSON.parse(line.slice(6));
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
            if (text) {
              res.write(`data: ${JSON.stringify({
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion.chunk",
                choices: [{ index: 0, delta: { content: text } }],
              })}\n\n`);
            }
          }
        }
      }
    },
  });
}

// --- Cloudflare Workers AI ---
if (CF_TOKEN && CF_ACCOUNT) {
  providers.push({
    name: "cloudflare",
    async call(messages, model, opts) {
      const resp = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${CF_TOKEN}` },
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
        usage: data.usage ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens } : undefined,
      };
    },
    async stream(messages, model, opts, res) {
      const resp = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${CF_TOKEN}` },
          body: JSON.stringify({
            model: model || "@cf/meta/llama-3.1-8b-instruct",
            messages,
            stream: true,
            ...(opts?.temperature !== undefined && { temperature: opts.temperature }),
            ...(opts?.max_tokens !== undefined && { max_tokens: opts.max_tokens }),
          }),
        }
      );
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload);
              const text = json.choices?.[0]?.delta?.content || "";
              if (text) {
                res.write(`data: ${JSON.stringify({
                  id: `chatcmpl-${Date.now()}`,
                  object: "chat.completion.chunk",
                  choices: [{ index: 0, delta: { content: text } }],
                })}\n\n`);
              }
            } catch {}
          }
        }
      }
    },
  });
}

// --- NVIDIA NIM ---
if (NVIDIA_KEY) {
  providers.push({
    name: "nvidia",
    async call(messages, model, opts) {
      const resp = await fetch(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${NVIDIA_KEY}` },
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
        usage: data.usage ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens } : undefined,
      };
    },
    async stream(messages, model, opts, res) {
      const resp = await fetch(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${NVIDIA_KEY}` },
          body: JSON.stringify({
            model: model || "meta/llama-3.3-70b-instruct",
            messages,
            stream: true,
            ...(opts?.temperature !== undefined && { temperature: opts.temperature }),
            ...(opts?.max_tokens !== undefined && { max_tokens: opts.max_tokens }),
          }),
        }
      );
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload);
              const text = json.choices?.[0]?.delta?.content || "";
              if (text) {
                res.write(`data: ${JSON.stringify({
                  id: `chatcmpl-${Date.now()}`,
                  object: "chat.completion.chunk",
                  choices: [{ index: 0, delta: { content: text } }],
                })}\n\n`);
              }
            } catch {}
          }
        }
      }
    },
  });
}

// --- Endpoint con failover + streaming ---
// --- Cohere ---
if (COHERE_KEY) {
  providers.push({
    name: "cohere",
    async call(messages, model, opts) {
      const resp = await fetch(
        "https://api.cohere.com/v2/chat",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${COHERE_KEY}` },
          body: JSON.stringify({
            model: model || "command-r-08-2024",
            messages,
            ...(opts?.temperature !== undefined && { temperature: opts.temperature }),
            ...(opts?.max_tokens !== undefined && { max_tokens: opts.max_tokens }),
          }),
        }
      );
      const data = await resp.json();
      if (data.message === undefined) throw new Error(data.message || "Cohere error");
      return {
        text: data.message?.content?.[0]?.text || "",
        usage: data.usage ? { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens, total_tokens: data.usage.input_tokens + data.usage.output_tokens } : undefined,
      };
    },
    async stream(messages, model, opts, res) {
      const resp = await fetch(
        "https://api.cohere.com/v2/chat?stream=true",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${COHERE_KEY}` },
          body: JSON.stringify({
            model: model || "command-r-08-2024",
            messages,
            ...(opts?.temperature !== undefined && { temperature: opts.temperature }),
            ...(opts?.max_tokens !== undefined && { max_tokens: opts.max_tokens }),
          }),
        }
      );
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload);
              const text = json?.text || "";
              if (text) {
                res.write(`data: ${JSON.stringify({
                  id: `chatcmpl-${Date.now()}`,
                  object: "chat.completion.chunk",
                  choices: [{ index: 0, delta: { content: text } }],
                })}\n\n`);
              }
            } catch {}
          }
        }
      }
    },
  });
}   
app.post("/v1/chat/completions", async (req, res) => {
  const { messages, model, temperature, max_tokens, stream } = req.body;

  if (providers.length === 0) {
    return res.status(500).json({ error: "No hay proveedores configurados." });
  }

  const errors: string[] = [];

  for (const p of providers) {
    try {
      if (stream) {
        // Streaming: no se puede hacer failover a mitad de stream
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.write(`data: ${JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { role: "assistant", content: "" } }],
        })}\n\n`);
        await p.stream(messages, model, { temperature, max_tokens }, res);
        res.write("data: [DONE]\n\n");
        return res.end();
      } else {
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
      }
    } catch (err: any) {
      errors.push(`${p.name}: ${err.message}`);
      if (stream) {
        // Si ya empezamos a streamear, no podemos hacer failover
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      continue;
    }
  }

  res.status(502).json({ error: "Todos los proveedores fallaron", details: errors });
});

// --- Health check ---
app.get("/health", (_req, res) => {
  res.json({ status: "ok", providers: providers.map(p => p.name) });
});

app.listen(PORT, () => {
  console.log(`?? Free LLM Gateway corriendo en http://localhost:${PORT}`);
  console.log(`   Provedores: ${providers.map(p => p.name).join(", ") || "NINGUNO"}`);
  console.log(`   POST /v1/chat/completions (stream: true para SSE)`);
  console.log(`   GET  /health`);
});   
