import { useState } from "react"
import { Moon, Sun, Monitor } from "lucide-react"

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/client/components/ui/card"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Label } from "@/client/components/ui/label"
import { Separator } from "@/client/components/ui/separator"
import { useTheme } from "@/client/components/theme-provider"
import { cn } from "@/client/lib/utils"
import { toast } from "@/client/methods/notify"

export function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const [name, setName] = useState("Admin User")
  const [email, setEmail] = useState("admin@tiny-web.local")

  function onSave(e: React.FormEvent) {
    e.preventDefault()
    toast.success("Settings saved")
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="text-muted-foreground text-sm">
          Manage your account preferences and appearance.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Update your display name and email</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSave} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Display name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit">Save changes</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose how Tiny-Web looks to you</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <ThemeOption
              label="Light"
              icon={Sun}
              active={theme === "light"}
              onClick={() => setTheme("light")}
            />
            <ThemeOption
              label="Dark"
              icon={Moon}
              active={theme === "dark"}
              onClick={() => setTheme("dark")}
            />
            <ThemeOption
              label="System"
              icon={Monitor}
              active={theme === "system"}
              onClick={() => setTheme("system")}
            />
          </div>
          <Separator className="my-4" />
          <p className="text-muted-foreground text-xs">
            Preferences are stored locally in your browser.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function ThemeOption({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary/5 text-primary"
          : "border-border hover:border-primary/50 hover:bg-accent"
      )}
    >
      <Icon className="size-5" />
      {label}
    </button>
  )
}
