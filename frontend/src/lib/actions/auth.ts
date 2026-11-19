"use server"

import { redirect } from "next/navigation"

import {
  backendLogin,
  backendLogout,
  backendRegister,
} from "@/lib/api/auth"
import { authErrorMessage } from "@/lib/auth-errors"
import {
  createSession,
  destroySession,
  getSessionRefreshToken,
  sanitizeNextPath,
} from "@/lib/session"

export interface AuthFormState {
  error?: string
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : ""
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = field(formData, "email")
  const password = field(formData, "password")
  const next = sanitizeNextPath(formData.get("next"))

  if (!email || !password) {
    return { error: "Enter your email and password." }
  }

  try {
    const result = await backendLogin(email, password)
    await createSession(result)
  } catch (error) {
    return { error: authErrorMessage(error) }
  }
  redirect(next)
}

export async function registerAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const name = field(formData, "name")
  const email = field(formData, "email")
  const password = field(formData, "password")
  const next = sanitizeNextPath(formData.get("next"))

  if (!name || !email || !password) {
    return { error: "Fill in your name, email and password." }
  }
  // Mirror the backend's headline rules for instant feedback — the
  // backend remains the authoritative validator.
  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return {
      error: "Password must be at least 8 characters with a letter and a digit.",
    }
  }

  try {
    const result = await backendRegister(name, email, password)
    await createSession(result)
  } catch (error) {
    return { error: authErrorMessage(error) }
  }
  redirect(next)
}

export async function logoutAction(): Promise<void> {
  const refreshToken = await getSessionRefreshToken()
  if (refreshToken) {
    try {
      await backendLogout(refreshToken)
    } catch {
      // Backend revocation is best-effort — local destruction below is
      // what actually ends the user's access here.
    }
  }
  await destroySession()
  redirect("/login")
}
