import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { getSession, sanitizeNextPath } from "@/lib/session"
import { AuthCard } from "../_components/auth-card"
import { RegisterForm } from "../_components/register-form"

export const metadata: Metadata = {
  title: "Create account — SearchForge",
}

export default async function RegisterPage({
  searchParams,
}: PageProps<"/register">) {
  const params = await searchParams
  const next = sanitizeNextPath(params.next)
  if (await getSession()) {
    redirect(next)
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Search technical documentation with your own session."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm next={next} />
    </AuthCard>
  )
}
