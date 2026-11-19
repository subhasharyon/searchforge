"use client"

import { useActionState } from "react"

import { registerAction } from "@/lib/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function RegisterForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(registerAction, {})

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.error}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <label
          htmlFor="register-name"
          className="text-sm font-medium text-foreground"
        >
          Name
        </label>
        <Input
          id="register-name"
          name="name"
          type="text"
          autoComplete="name"
          required
          maxLength={100}
          placeholder="Ada Lovelace"
        />
      </div>
      <div className="space-y-1.5">
        <label
          htmlFor="register-email"
          className="text-sm font-medium text-foreground"
        >
          Email
        </label>
        <Input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
        />
      </div>
      <div className="space-y-1.5">
        <label
          htmlFor="register-password"
          className="text-sm font-medium text-foreground"
        >
          Password
        </label>
        <Input
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-describedby="register-password-hint"
          placeholder="••••••••"
        />
        <p
          id="register-password-hint"
          className="text-xs text-muted-foreground"
        >
          At least 8 characters, with a letter and a digit.
        </p>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  )
}
