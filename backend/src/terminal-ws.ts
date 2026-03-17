import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "http";
import { spawn as ptySpawn, type IPty } from "node-pty";
import { getSession } from "./db/repositories/sessions.js";
import { logger } from "./logger.js";
import { homedir } from "os";

interface TerminalSession {
  pty: IPty;
  ws: WebSocket;
  sessionId: string;
}

const activeSessions = new Map<WebSocket, TerminalSession>();

let wss: WebSocketServer | null = null;

export function setupTerminalWs(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: "/terminal-ws" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      const sessionId = url.searchParams.get("sessionId");

      if (!sessionId) {
        ws.close(4004, "Missing sessionId");
        return;
      }

      const session = getSession(sessionId);
      if (!session) {
        ws.close(4004, "Session not found");
        return;
      }

      if (!session.tmux_session_name) {
        ws.close(4004, "Session has no tmux session");
        return;
      }

      const tmuxPath = process.env.TMUX_PATH || "tmux";

      const pty = ptySpawn(tmuxPath, ["attach-session", "-t", session.tmux_session_name], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: homedir(),
        env: {
          HOME: homedir(),
          TERM: "xterm-256color",
          PATH: process.env.PATH || "/usr/bin:/bin",
        },
      });

      const termSession: TerminalSession = { pty, ws, sessionId };
      activeSessions.set(ws, termSession);

      pty.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      pty.onExit(() => {
        activeSessions.delete(ws);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, "PTY exited");
        }
      });

      ws.on("message", (data) => {
        const msg = data.toString();

        // Check for resize messages (JSON with type: "resize")
        if (msg.startsWith("{")) {
          try {
            const parsed = JSON.parse(msg);
            if (parsed.type === "resize" && parsed.cols && parsed.rows) {
              pty.resize(parsed.cols, parsed.rows);
              return;
            }
          } catch {
            // Not JSON — fall through to write as terminal input
          }
        }

        pty.write(msg);
      });

      ws.on("close", () => {
        activeSessions.delete(ws);
        pty.kill();
      });

      ws.on("error", (err) => {
        logger.error({ err, sessionId }, "Terminal WebSocket error");
        activeSessions.delete(ws);
        pty.kill();
      });

      logger.info({ sessionId, tmux: session.tmux_session_name }, "Terminal WebSocket connected");
    } catch (err) {
      logger.error({ err }, "Terminal WebSocket connection setup failed");
      ws.close(4011, "Internal error");
    }
  });

  return wss;
}

export function shutdownTerminalWs(): void {
  for (const [ws, session] of activeSessions) {
    session.pty.kill();
    ws.close(1001, "Going Away");
  }
  activeSessions.clear();
  wss?.close();
}
