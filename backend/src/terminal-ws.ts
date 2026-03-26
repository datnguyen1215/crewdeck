import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "http";
import { spawn as ptySpawn, type IPty } from "node-pty";
import { logger } from "./logger.js";
import { homedir } from "os";
import { getTerminalSession } from "./orchestration/captain/pty-service.js";

interface TerminalSession {
  pty: IPty;
  ws: WebSocket;
  projectId: string;
}

const activeSessions = new Map<WebSocket, TerminalSession>();

let wss: WebSocketServer | null = null;

export function setupTerminalWs(server: Server): WebSocketServer {
  wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      const projectId = url.searchParams.get("projectId");

      if (!projectId) {
        ws.close(4004, "Missing projectId");
        return;
      }

      const session = getTerminalSession(projectId);
      if (!session) {
        ws.close(4004, "Terminal session not found");
        return;
      }

      const tmuxPath = process.env.TMUX_PATH || "tmux";

      const pty = ptySpawn(
        tmuxPath,
        ["attach-session", "-t", session.tmuxSessionName],
        {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd: homedir(),
          env: {
            HOME: homedir(),
            TERM: "xterm-256color",
            PATH: process.env.PATH || "/usr/bin:/bin",
          },
        },
      );

      const termSession: TerminalSession = { pty, ws, projectId };
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
        logger.error({ err, projectId }, "Terminal WebSocket error");
        activeSessions.delete(ws);
        pty.kill();
      });

      logger.info({ projectId, tmux: session.tmuxSessionName }, "Terminal WebSocket connected");
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
