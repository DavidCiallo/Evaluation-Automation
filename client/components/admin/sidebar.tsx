import { NavLink } from "react-router-dom"
import {
  LayoutDashboard,
  Headset,
  ClipboardList,
  Users,
  IdCard,
  Settings,
  BarChart3,
  Bot,
  Mail,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/client/lib/utils"
import { Badge } from "@/client/components/ui/badge"
import logoUrl from "@/client/assets/logo.svg"

type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  badge?: string
}

const mainNav: NavItem[] = [
  { title: "总览仪表盘", href: "/dashboard", icon: LayoutDashboard },
  { title: "客服工作台", href: "/workbench", icon: Headset, badge: "AI" },
  { title: "订单管理", href: "/orders", icon: ClipboardList },
  { title: "客户档案", href: "/customers", icon: IdCard },
  { title: "邮件中心", href: "/emails", icon: Mail, badge: "AI" },
  { title: "客服账号", href: "/account", icon: Users },
]

const secondaryNav: NavItem[] = [
  { title: "统计管理", href: "/statistics", icon: BarChart3 },
  { title: "智能体配置", href: "/agent-config", icon: Bot },
  { title: "系统配置", href: "/settings", icon: Settings },
]

export function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <img src={logoUrl} alt="" className="size-8" aria-hidden="true" />
        <span className="text-lg font-semibold tracking-tight">自动化服务评估台</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        <p className="text-muted-foreground px-3 pb-2 pt-2 text-xs font-semibold uppercase tracking-wider">
          工作区
        </p>
        {mainNav.map((item) => (
          <SidebarItem key={item.href} item={item} onNavigate={onNavigate} />
        ))}

        <p className="text-muted-foreground px-3 pb-2 pt-6 text-xs font-semibold uppercase tracking-wider">
          管理
        </p>
        {secondaryNav.map((item) => (
          <SidebarItem key={item.href} item={item} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="border-t p-3">
        <div className="bg-sidebar-accent text-sidebar-accent-foreground rounded-lg p-3 text-xs">
          <p className="font-medium">智能评价与自动化</p>
          <p className="text-muted-foreground mt-1">V1.0 · 评审稿</p>
        </div>
      </div>
    </>
  )
}

export function DesktopSidebar() {
  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden h-screen w-60 shrink-0 flex-col border-r md:flex">
      <SidebarBody />
    </aside>
  )
}

function SidebarItem({
  item,
  onNavigate,
}: {
  item: NavItem
  onNavigate?: () => void
}) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.href}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground/80"
        )
      }
    >
      <Icon className="size-4" />
      <span className="flex-1">{item.title}</span>
      {item.badge && (
        <Badge variant="secondary" className="h-5 px-1.5 text-xs">
          {item.badge}
        </Badge>
      )}
    </NavLink>
  )
}
