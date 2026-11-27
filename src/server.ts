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
const ZAI_KEY = process.env.ZAI_API_KEY;   
const GROQ_KEY = process.env.GROQ_API_KEY;   
const HF_KEY = process.env.HF_API_KEY;
const PORT = 3000;

interface Provider {
  name: string;
  call: (messages: any[], model?: string, opts?: any) => Promise<{ text: string; usage?: any }>;
  stream: (messages: any[], model?: string, opts?: any, res?: any) => Promise<void>;
}

const providers: Provider[] = [];

// --- Métricas ---
const metrics: Record<string, { requests: number; errors: number; tokens: number; lastUsed: number }> = {};
for (const p of ["google", "cloudflare", "nvidia", "cohere", "zai", "groq", "huggingface", "ovhcloud"]) {         
  metrics[p] = { requests: 0, errors: 0, tokens: 0, lastUsed: 0 };
}   

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

// --- Z.ai (GLM) ---
if (ZAI_KEY) {
  providers.push({
    name: "zai",
    async call(messages, model, opts) {
      const resp = await fetch(
        "https://api.z.ai/api/paas/v4/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ZAI_KEY}` },
          body: JSON.stringify({
            model: model || "glm-4.7-flash",
            messages,
            ...(opts?.temperature !== undefined && { temperature: opts.temperature }),
            ...(opts?.max_tokens !== undefined && { max_tokens: opts.max_tokens }),
          }),
        }
      );
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || "Z.ai error");
      return {
        text: data.choices?.[0]?.message?.content || "",
        usage: data.usage ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens } : undefined,
      };
    },
    async stream(messages, model, opts, res) {
      const resp = await fetch(
        "https://api.z.ai/api/paas/v4/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ZAI_KEY}` },
          body: JSON.stringify({
            model: model || "glm-4.7-flash",
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
// --- Smart Routing ---
function bestProvider(messages: any[]): string {
  const lastMsg = messages[messages.length - 1]?.content || "";
  const lower = lastMsg.toLowerCase();

    if (/\b(código|code|function|función|funciones|def |class |import |bug|error|fix|debug|script|api|python|javascript|typescript|java|html|css|sql|programa|programar|factorial|algoritmo)\b/i.test(lower)) {   
    return "groq";
  }
  if (/\b(analiz|reason|explica por qué|compara|evalúa|pros y contras|demostr|teorema|algoritmo)\b/.test(lower)) {
    return "nvidia";
  }
  if (/\b(translate|traduce|traducir|idioma|language|francés|inglés|español|alemán)\b/.test(lower)) {
    return "google";
  }
  return "google";
}   
app.post("/v1/chat/completions", async (req, res) => {
  const { messages, model, temperature, max_tokens, stream } = req.body;

  if (providers.length === 0) {
    return res.status(500).json({ error: "No hay proveedores configurados." });
  }

  const errors: string[] = [];

  const preferred = bestProvider(messages);
  const ordered = [
    ...providers.filter(p => p.name === preferred),
    ...providers.filter(p => p.name !== preferred),
  ];

  for (const p of ordered) {
    try {
  metrics[p.name].requests++;
  if (stream) {
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
    metrics[p.name].tokens += result.usage?.total_tokens || 0;
    metrics[p.name].lastUsed = Date.now();
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
  metrics[p.name].errors++;
  errors.push(`${p.name}: ${err.message}`);
  if (stream) {
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
// --- Groq ---
if (GROQ_KEY) {
  providers.push({
    name: "groq",
    async call(messages, model, opts) {
      const resp = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
          body: JSON.stringify({
            model: model || "openai/gpt-oss-120b",
            messages,
            ...(opts?.temperature !== undefined && { temperature: opts.temperature }),
            ...(opts?.max_tokens !== undefined && { max_tokens: opts.max_tokens }),
          }),
        }
      );
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || "Groq error");
      return {
        text: data.choices?.[0]?.message?.content || "",
        usage: data.usage ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens } : undefined,
      };
    },
    async stream(messages, model, opts, res) {
      const resp = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
          body: JSON.stringify({
            model: model || "openai/gpt-oss-120b",
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
// --- HuggingFace ---
if (HF_KEY) {
  providers.push({
    name: "huggingface",
    async call(messages, model, opts) {
      const resp = await fetch(
        "https://router.huggingface.co/v1/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${HF_KEY}` },
          body: JSON.stringify({
            model: model || "meta-llama/Llama-3.3-70B-Instruct",
            messages,
            ...(opts?.temperature !== undefined && { temperature: opts.temperature }),
            ...(opts?.max_tokens !== undefined && { max_tokens: opts.max_tokens }),
          }),
        }
      );
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || "HuggingFace error");
      return {
        text: data.choices?.[0]?.message?.content || "",
        usage: data.usage ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens } : undefined,
      };
    },
    async stream(messages, model, opts, res) {
      const resp = await fetch(
        "https://router.huggingface.co/v1/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${HF_KEY}` },
          body: JSON.stringify({
            model: model || "meta-llama/Llama-3.3-70B-Instruct",
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
// --- OVHcloud (fallback sin key) ---
providers.push({
  name: "ovhcloud",
  async call(messages, model, opts) {
    const resp = await fetch(
      "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "gpt-oss-120b",
          messages,
          ...(opts?.temperature !== undefined && { temperature: opts.temperature }),
          ...(opts?.max_tokens !== undefined && { max_tokens: opts.max_tokens }),
        }),
      }
    );
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || "OVHcloud error");
    return {
      text: data.choices?.[0]?.message?.content || "",
      usage: data.usage ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens } : undefined,
    };
  },
  async stream(messages, model, opts, res) {
    const resp = await fetch(
      "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "gpt-oss-120b",
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
// --- Dashboard ---
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Free LLM Gateway</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f0f23;color:#e0e0e0;min-height:100vh;padding:2rem}
h1{text-align:center;font-size:1.8rem;margin-bottom:.5rem;background:linear-gradient(135deg,#667eea,#764ba2);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.subtitle{text-align:center;color:#888;margin-bottom:2rem;font-size:.9rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;max-width:1200px;margin:0 auto}
.card{background:#1a1a2e;border:1px solid #2a2a4a;border-radius:12px;padding:1.2rem;position:relative;overflow:hidden;transition:transform .2s}
.card:hover{transform:translateY(-2px);border-color:#667eea}
.card .name{font-size:.85rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:.8rem}
.card .status{position:absolute;top:1rem;right:1rem;width:10px;height:10px;border-radius:50%;background:#444}
.card .status.active{background:#00e676;box-shadow:0 0 8px #00e676}
.card .status.error{background:#ff5252;box-shadow:0 0 8px #ff5252}
.stat{display:flex;justify-content:space-between;margin:.4rem 0;font-size:.9rem}
.stat .label{color:#888}
.stat .value{font-weight:600;color:#e0e0e0}
.stat .value.tokens{color:#667eea}
.stat .value.errors{color:#ff5252}
.summary{max-width:1200px;margin:2rem auto;padding:1.5rem;background:#1a1a2e;border:1px solid #2a2a4a;border-radius:12px;text-align:center}
.summary h2{font-size:1rem;color:#888;margin-bottom:1rem;text-transform:uppercase;letter-spacing:1px}
.summary .big{font-size:2.5rem;font-weight:700;background:linear-gradient(135deg,#667eea,#764ba2);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.summary .detail{color:#888;font-size:.85rem;margin-top:.5rem}
.uptime{margin-top:.5rem;color:#667eea;font-size:.8rem}
</style>
</head>
<body>
<h1>🚀 Free LLM Gateway</h1>
<p class="subtitle">5 providers · Auto-failover · Streaming · Zero cost</p>
<div class="grid" id="providers"></div>
<div class="summary">
  <h2>Total Tokens Consumidos</h2>
  <div class="big" id="totalTokens">0</div>
  <div class="detail" id="totalRequests">0 requests · 0 errors</div>
  <div class="uptime" id="uptime"></div>
</div>
<script>
async function refresh(){
  try{
    const r=await fetch('/metrics');
    const d=await r.json();
    const grid=document.getElementById('providers');
    grid.innerHTML='';
    let totalTokens=0,totalReq=0,totalErr=0;
    const names=Object.keys(d.metrics);
    for(const name of names){
      const m=d.metrics[name];
      totalTokens+=m.tokens;totalReq+=m.requests;totalErr+=m.errors;
      const lastUsed=m.lastUsed?new Date(m.lastUsed).toLocaleTimeString():'—';
      const status=m.errors>0?'error':(m.requests>0?'active':'');
      grid.innerHTML+=\`<div class="card">
        <div class="name">\${name}</div>
        <div class="status \${status}"></div>
        <div class="stat"><span class="label">Requests</span><span class="value">\${m.requests}</span></div>
        <div class="stat"><span class="label">Errors</span><span class="value errors">\${m.errors}</span></div>
        <div class="stat"><span class="label">Tokens</span><span class="value tokens">\${m.tokens.toLocaleString()}</span></div>
        <div class="stat"><span class="label">Last used</span><span class="value">\${lastUsed}</span></div>
      </div>\`;
    }
    document.getElementById('totalTokens').textContent=totalTokens.toLocaleString();
    document.getElementById('totalRequests').textContent=\`\${totalReq} requests · \${totalErr} errors\`;
    const up=d.uptime;
    const mins=Math.floor(up/60);
    const secs=Math.floor(up%60);
    document.getElementById('uptime').textContent='Uptime: \${mins}m \${secs}s';
  }catch(e){}
}
refresh();
setInterval(refresh,5000);
</script>
</body>
</html>`;

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(DASHBOARD_HTML);
});   

app.get("/health", (_req, res) => {
  res.json({ status: "ok", providers: providers.map(p => p.name) });
});

app.get("/metrics", (_req, res) => {
  res.json({ metrics, uptime: process.uptime() });
});   

app.listen(PORT, () => {
  console.log(`?? Free LLM Gateway corriendo en http://localhost:${PORT}`);
  console.log(`   Provedores: ${providers.map(p => p.name).join(", ") || "NINGUNO"}`);
  console.log(`   POST /v1/chat/completions (stream: true para SSE)`);
  console.log(`   GET  /health`);
  console.log(`   GET  /metrics`);
});   
