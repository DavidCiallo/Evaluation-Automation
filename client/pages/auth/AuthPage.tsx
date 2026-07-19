import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Lock, Mail, Loader2 } from "lucide-react"

import { Button } from "@/client/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/client/components/ui/card"
import { Input } from "@/client/components/ui/input"
import { Label } from "@/client/components/ui/label"
import { authApi } from "@/client/api/instance"
import { setAuth } from "@/client/methods/auth"
import { toast } from "@/client/methods/notify"

export function AuthPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("admin@tiny-web.local")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function onLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await authApi.login({ identify: { email, password } })
    setLoading(false)
    if (res.success && res.data?.token) {
      setAuth(res.data.token)
      toast.success("Signed in")
      navigate("/dashboard")
    } else {
      toast.error(res.message || "Login failed")
    }
  }

  return (
    <div className="bg-muted/30 flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="bg-primary text-primary-foreground mx-auto mb-2 flex size-12 items-center justify-center rounded-xl text-xl font-bold">
            T
          </div>
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>Sign in to your Tiny-Web admin panel</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onLogin} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-8"
                  required
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-8"
                  required
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
