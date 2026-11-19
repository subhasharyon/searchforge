import type { AuthTokens } from "@/types/api"

/** Safe user shape returned by backend auth endpoints (no passwordHash). */
export interface PublicUser {
  id: string
  name: string
  email: string
  role: "user" | "admin"
  status: "active" | "suspended"
  createdAt: string
  updatedAt: string
}

/** `data` payload of /auth/register, /auth/login and /auth/refresh. */
export interface AuthResult {
  user: PublicUser
  tokens: AuthTokens
}
