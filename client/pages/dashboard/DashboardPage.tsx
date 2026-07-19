import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  Activity,
  Users,
  Newspaper,
  FlaskConical,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react"

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/client/components/ui/card"
import { Button } from "@/client/components/ui/button"
import { Badge } from "@/client/components/ui/badge"
import { Skeleton } from "@/client/components/ui/skeleton"
import { accountApi, blogApi, demoApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"

type Stats = {
  accounts: number
  blogs: number
  demos: number
}

export function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const auth = getAuth()

  useEffect(() => {
    async function load() {
      const [acc, blog, demo] = await Promise.all([
        accountApi.list({ page: 1, auth }),
        blogApi.list({ page: 1, auth }),
        demoApi.list({ page: 1, auth }),
      ])
      setStats({
        accounts: acc.data?.total ?? 0,
        blogs: blog.data?.total ?? 0,
        demos: demo.data?.total ?? 0,
      })
      setLoading(false)
    }
    load()
  }, [auth])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          Welcome back, Admin
        </h2>
        <p className="text-muted-foreground text-sm">
          Here's what's happening across your workspace today.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Accounts"
          value={stats?.accounts}
          loading={loading}
          delta="+12.5%"
          trend="up"
          icon={Users}
        />
        <StatCard
          title="Blog Posts"
          value={stats?.blogs}
          loading={loading}
          delta="+4.3%"
          trend="up"
          icon={Newspaper}
        />
        <StatCard
          title="Demos"
          value={stats?.demos}
          loading={loading}
          delta="-1.8%"
          trend="down"
          icon={FlaskConical}
        />
        <StatCard
          title="Active Now"
          value={42}
          loading={loading}
          delta="+8.1%"
          trend="up"
          icon={Activity}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Weekly activity</CardTitle>
            <CardDescription>API requests served over the past 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-48 items-end gap-3">
              {[38, 52, 41, 67, 49, 78, 60].map((h, i) => (
                <div
                  key={i}
                  className="bg-primary/80 hover:bg-primary group relative flex-1 rounded-t-md transition-all"
                  style={{ height: `${h}%` }}
                >
                  <span className="text-primary-foreground absolute -top-6 left-1/2 -translate-x-1/2 text-xs opacity-0 transition-opacity group-hover:opacity-100">
                    {Math.round(h * 3.2)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Latest events from the system</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { who: "Admin", what: "published a blog post", when: "2m ago" },
              { who: "alice", what: "logged in", when: "1h ago" },
              { who: "bob", what: "created a demo record", when: "3h ago" },
              { who: "system", what: "ran daily backup", when: "6h ago" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <div className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                  {item.who[0].toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="leading-tight">
                    <span className="font-medium">{item.who}</span>{" "}
                    <span className="text-muted-foreground">{item.what}</span>
                  </p>
                </div>
                <span className="text-muted-foreground text-xs">{item.when}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick actions</CardTitle>
          <CardDescription>Jump to a frequently used workspace</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/blog">
              Write a post <ArrowUpRight className="size-4" />
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/demo">Create demo</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/account">Manage accounts</Link>
          </Button>
          <Button variant="ghost">
            <Badge variant="secondary" className="mr-1">v1.0</Badge>
            View changelog
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({
  title,
  value,
  loading,
  delta,
  trend,
  icon: Icon,
}: {
  title: string
  value?: number
  loading: boolean
  delta: string
  trend: "up" | "down"
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardDescription>{title}</CardDescription>
          <div className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-md">
            <Icon className="size-4" />
          </div>
        </div>
        <CardTitle className="text-3xl">
          {loading || value === undefined ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            value.toLocaleString()
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`flex items-center gap-1 text-xs ${
            trend === "up"
              ? "text-emerald-500"
              : "text-destructive"
          }`}
        >
          {trend === "up" ? (
            <ArrowUpRight className="size-3" />
          ) : (
            <ArrowDownRight className="size-3" />
          )}
          <span className="font-medium">{delta}</span>
          <span className="text-muted-foreground">vs last week</span>
        </div>
      </CardContent>
    </Card>
  )
}
