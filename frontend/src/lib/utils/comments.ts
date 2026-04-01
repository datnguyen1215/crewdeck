import type { Comment } from "$lib/api/http.js";

export function commentStyle(authorType: string): {
  border: string;
  textColor: string;
} {
  if (authorType === "system")
    return { border: "var(--color-muted)", textColor: "text-muted" };
  if (authorType === "user")
    return { border: "var(--color-edge-hi)", textColor: "text-secondary" };
  return { border: "var(--color-cyan)", textColor: "text-cyan" };
}

export function commentAuthorLabel(comment: Comment): string {
  if (comment.author_type === "system") return "System";
  if (comment.author_type === "user") return "User";
  return (
    comment.author_type.charAt(0).toUpperCase() + comment.author_type.slice(1)
  );
}
