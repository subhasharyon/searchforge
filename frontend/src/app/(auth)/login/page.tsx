import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { getSession, sanitizeNextPath } from "@/lib/session"
import { AuthCard } from "../_components/auth-card"
import { LoginForm } from "../_components/login-form"

export const metadata: Metadata = {
  title: "Sign in — SearchForge",
}

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams
  const next = sanitizeNextPath(params.next)
  if (await getSession()) {
    redirect(next)
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Access your technical search workspace."
      footer={
        <>
          New to SearchForge?{" "}
          <Link
            href={`/register?next=${encodeURIComponent(next)}`}
            className="font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm next={next} />
    </AuthCard>
  )
}
