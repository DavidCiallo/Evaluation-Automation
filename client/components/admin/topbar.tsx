import { useLocation } from "react-router-dom"
import { Bell, Menu, Search } from "lucide-react"

import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Separator } from "@/client/components/ui/separator"
import { ThemeToggle } from "@/client/components/theme-toggle"
import { UserMenu } from "@/client/components/admin/user-menu"

const titleMap: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/demo": "Demo",
  "/blog": "Blog",
  "/account": "Accounts",
  "/settings": "Settings",
}

export function Topbar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const { pathname } = useLocation()
  const title = titleMap[pathname] ?? "Tiny-Web"

  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30 flex h-16 items-center gap-2 border-b px-4 backdrop-blur sm:gap-4 sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </Button>

      <h1 className="hidden text-lg font-semibold tracking-tight sm:block">
        {title}
      </h1>
      <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />

      <div className="relative ml-1 hidden max-w-md flex-1 md:block">
        <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
        <Input
          placeholder="Search..."
          className="bg-muted/40 h-9 border-none pl-8"
        />
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="size-4" />
          <span className="bg-destructive absolute right-1.5 top-1.5 size-2 rounded-full" />
          <span className="sr-only">Notifications</span>
        </Button>
        <ThemeToggle />
        <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />
        <UserMenu />
      </div>
    </header>
  )
}
