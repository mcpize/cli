import http from "node:http";
import net from "node:net";

export async function findAvailablePort(start = 54321, end = 54340): Promise<number> {
  for (let port = start; port <= end; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close();
        resolve(true);
      });
      server.listen(port, "localhost");
    });
    if (available) return port;
  }
  throw new Error("No available ports for callback server");
}

function sendHtmlPage(
  res: http.ServerResponse,
  status: number,
  title: string,
  subtitle: string,
  accentColor: string,
  emoji: string,
): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Connection": "close" });
  res.end(`<!DOCTYPE html>
<html>
<head>
  <title>${title} | MCPize</title>
  <link rel="icon" href="https://mcpize.com/favicon.ico">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh; margin: 0;
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
      color: white;
    }
    .container { text-align: center; padding: 3rem 2rem; max-width: 420px; }
    .icon {
      width: 80px; height: 80px;
      background: linear-gradient(135deg, ${accentColor} 0%, ${accentColor}dd 100%);
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      margin: 0 auto 1.5rem; font-size: 2.5rem;
      box-shadow: 0 8px 32px ${accentColor}4d;
    }
    h1 {
      font-size: 1.75rem; font-weight: 600; margin: 0 0 0.5rem;
      background: linear-gradient(135deg, #fff 0%, #a1a1aa 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }
    .subtitle { color: #71717a; font-size: 1rem; margin: 0; }
    .footer { margin-top: 2rem; color: #52525b; font-size: 0.85rem; }
    .footer a { color: #71717a; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${emoji}</div>
    <h1>${title}</h1>
    <p class="subtitle">${subtitle}</p>
    <p class="footer"><a href="https://mcpize.com">mcpize.com</a></p>
  </div>
</body>
</html>`);
}

export interface CallbackServerOptions {
  expectedState?: string;
  callbackPath?: string;
  validateParams?: (params: URLSearchParams) => { valid: boolean; error?: string };
  successTitle?: string;
  successSubtitle?: string;
  successEmoji?: string;
}

export function createCallbackServer(
  port: number,
  options: CallbackServerOptions = {},
): { promise: Promise<Record<string, string>>; server: http.Server } {
  const {
    callbackPath = "/callback",
    successTitle = "You're in!",
    successSubtitle = "Head back to your terminal — you're all set.",
    successEmoji = "🚀",
  } = options;

  let resolvePromise: (params: Record<string, string>) => void;
  let rejectPromise: (error: Error) => void;

  const promise = new Promise<Record<string, string>>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);

    if (url.pathname !== callbackPath) {
      res.writeHead(404, { "Connection": "close" });
      res.end("Not found");
      return;
    }

    if (options.expectedState) {
      const state = url.searchParams.get("state");
      if (state !== options.expectedState) {
        sendHtmlPage(res, 400, "Something went wrong", "Invalid state parameter. Please try again.", "#ef4444", "😅");
        rejectPromise(new Error("Invalid state parameter"));
        return;
      }
    }

    const error = url.searchParams.get("error");
    if (error) {
      sendHtmlPage(res, 400, "Something went wrong", error, "#ef4444", "😅");
      rejectPromise(new Error(error));
      return;
    }

    if (options.validateParams) {
      const result = options.validateParams(url.searchParams);
      if (!result.valid) {
        sendHtmlPage(res, 400, "Something went wrong", result.error || "Validation failed", "#ef4444", "😅");
        rejectPromise(new Error(result.error || "Validation failed"));
        return;
      }
    }

    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    sendHtmlPage(res, 200, successTitle, successSubtitle, "#8b5cf6", successEmoji);
    resolvePromise(params);
  });

  server.listen(port, "localhost");
  return { promise, server };
}
