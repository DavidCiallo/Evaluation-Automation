import { useNavigate } from "react-router-dom"
import { LogOut, User, Settings, LifeBuoy } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/client/components/ui/avatar"
import { Button } from "@/client/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu"
import { clearAuth } from "@/client/methods/auth"

const SEED = "admin@tiny-web.local"
const avatarUrl = `https://api.dicebear.com/7.x/glass/svg?seed=${encodeURIComponent(SEED)}`

export function UserMenu() {
  const navigate = useNavigate()

  function onLogout() {
    clearAuth()
    navigate("/auth", { replace: true })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="flex items-center gap-2 px-2">
          <Avatar className="size-7">
            <AvatarImage src={avatarUrl} alt="avatar" />
            <AvatarFallback className="text-xs">A</AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium sm:inline">Admin</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex items-center gap-2">
            <Avatar className="size-9">
              <AvatarImage src={avatarUrl} alt="avatar" />
              <AvatarFallback className="text-xs">A</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-sm font-medium">Admin User</span>
              <span className="text-muted-foreground text-xs font-normal">
                admin@tiny-web.local
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <User className="size-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Settings className="size-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem>
          <LifeBuoy className="size-4" />
          Support
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onLogout}>
          <LogOut className="size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
