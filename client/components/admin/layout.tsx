import { useState } from "react"
import { Outlet } from "react-router-dom"

import { DesktopSidebar, SidebarBody } from "@/client/components/admin/sidebar"
import { Topbar } from "@/client/components/admin/topbar"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetHeader,
} from "@/client/components/ui/sheet"

export function AdminLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="bg-background flex h-screen w-full overflow-hidden">
      <DesktopSidebar />

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="bg-sidebar text-sidebar-foreground w-72 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col">
            <SidebarBody onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
        <main className="bg-muted/30 flex flex-1 flex-col overflow-y-auto p-4 sm:p-6 min-h-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
