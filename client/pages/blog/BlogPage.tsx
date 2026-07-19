import { useEffect, useState } from "react"
import { Newspaper, Plus, Calendar } from "lucide-react"

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
import { Textarea } from "@/client/components/ui/textarea"
import { Badge } from "@/client/components/ui/badge"
import { Skeleton } from "@/client/components/ui/skeleton"
import { Separator } from "@/client/components/ui/separator"
import { blogApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import { toast } from "@/client/methods/notify"

interface BlogItem {
  id: string
  title: string
  content: string
  create_time: number
}

export function BlogPage() {
  const [list, setList] = useState<BlogItem[]>([])
  const [page, setPage] = useState(1)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const res = await blogApi.list({ page, auth: getAuth() })
    if (res.success) {
      setList(res.data?.list || [])
    } else {
      toast.error(res.message || "Failed to load")
    }
    setLoading(false)
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    const res = await blogApi.create({ title, content, auth: getAuth() })
    if (res.success) {
      setTitle("")
      setContent("")
      toast.success("Post published")
      load()
    } else {
      toast.error(res.message || "Publish failed")
    }
  }

  useEffect(() => {
    load()
  }, [page])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Blog</h2>
        <p className="text-muted-foreground text-sm">
          Publish and manage your posts.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>New post</CardTitle>
            <CardDescription>Write something for your readers</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="space-y-3">
              <div className="grid gap-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="A catchy headline"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="content">Content</Label>
                <Textarea
                  id="content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Your post in markdown..."
                  className="min-h-32"
                />
              </div>
              <Button type="submit" className="w-full">
                <Plus className="size-4" />
                Publish
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent posts</CardTitle>
            <CardDescription>{list.length} posts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ))
            ) : list.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center gap-2 py-16 text-center">
                <Newspaper className="size-8 opacity-40" />
                <p className="text-sm">No posts yet — write your first one!</p>
              </div>
            ) : (
              list.map((item) => (
                <article key={item.id} className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold leading-tight">{item.title}</h3>
                    <Badge variant="secondary" className="shrink-0">
                      <Calendar className="mr-1 size-3" />
                      {new Date(item.create_time).toLocaleDateString()}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                    {item.content || (
                      <span className="italic opacity-60">No content</span>
                    )}
                  </p>
                  <Separator />
                </article>
              ))
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Prev
              </Button>
              <span className="text-muted-foreground px-2 text-sm">
                Page {page}
              </span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
