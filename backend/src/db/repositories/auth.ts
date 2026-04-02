import { db } from "../index.js";
import crypto from "node:crypto";

export interface AdminUser {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

export function adminExists(): boolean {
  const row = db.prepare("SELECT COUNT(*) as count FROM AdminUser").get() as {
    count: number;
  };
  return row.count > 0;
}

export function getAdminByUsername(username: string): AdminUser | null {
  return (
    (db.prepare("SELECT * FROM AdminUser WHERE username = ?").get(username) as
      | AdminUser
      | undefined) ?? null
  );
}

export function createAdmin(username: string, passwordHash: string): AdminUser {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO AdminUser (id, username, password_hash) VALUES (?, ?, ?)",
  ).run(id, username, passwordHash);
  return db
    .prepare("SELECT * FROM AdminUser WHERE id = ?")
    .get(id) as AdminUser;
}

export function getAdminById(id: string): AdminUser | null {
  return (
    (db.prepare("SELECT * FROM AdminUser WHERE id = ?").get(id) as
      | AdminUser
      | undefined) ?? null
  );
}

export function createSession(userId: string, expiresAt: string): Session {
  const id = crypto.randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO Session (id, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(id, userId, expiresAt);
  return {
    id,
    user_id: userId,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  };
}

export function getSession(
  token: string,
): (Session & { username: string }) | null {
  return (
    (db
      .prepare(
        `SELECT s.*, u.username FROM Session s
     JOIN AdminUser u ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > datetime('now')`,
      )
      .get(token) as (Session & { username: string }) | undefined) ?? null
  );
}

export function deleteSession(token: string): void {
  db.prepare("DELETE FROM Session WHERE id = ?").run(token);
}

export function deleteSessionsByUserId(userId: string): void {
  db.prepare("DELETE FROM Session WHERE user_id = ?").run(userId);
}

export function cleanExpiredSessions(): void {
  db.prepare("DELETE FROM Session WHERE expires_at <= datetime('now')").run();
}
