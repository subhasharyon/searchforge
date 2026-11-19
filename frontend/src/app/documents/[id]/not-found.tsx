import Link from "next/link"
import { FileQuestion } from "lucide-react"

import { StateShell } from "@/components/shared/state-shell"
import { Button } from "@/components/ui/button"

export default function DocumentNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-16 sm:px-6">
      <StateShell
        icon={FileQuestion}
        title="Document not found"
        message="This document doesn't exist — it may have been removed from the index, or the link is incorrect."
      >
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          className="mt-6"
          render={<Link href="/search" />}
        >
          Back to search
        </Button>
      </StateShell>
    </div>
  )
}
