import { useEffect, useState } from "react"
import { Plus, Search, Users } from "lucide-react"

import {
  Card,
  CardContent,
} from "@/client/components/ui/card"
import { Avatar, AvatarFallback } from "@/client/components/ui/avatar"
import { Badge } from "@/client/components/ui/badge"
import { Skeleton } from "@/client/components/ui/skeleton"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Label } from "@/client/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table"
import { accountApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import { toast } from "@/client/methods/notify"

interface AccountItem {
  id: string
  name: string
  email: string
  wechat_id: string
  role: string
}

const PAGE_SIZE = 10

export function AccountPage() {
  const [all, setAll] = useState<AccountItem[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState("")

  const [dialogOpen, setDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: "", wechat_id: "" })

  // Load every page once so we can filter/search locally
  async function loadAll() {
    setLoading(true)
    const auth = getAuth()
    let acc: AccountItem[] = []
    let total = 0
    let p = 1
    do {
      const res = await accountApi.list({ page: p, auth })
      if (!res.success) {
        toast.error(res.message || "加载失败")
        break
      }
      const list = res.data?.list || []
      total = res.data?.total || 0
      acc = acc.concat(list)
      p++
    } while (acc.length < total)
    setAll(acc)
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  const kw = keyword.trim().toLowerCase()
  const filtered = kw
    ? all.filter(
        (a) =>
          a.name.toLowerCase().includes(kw) ||
          (a.wechat_id || "").toLowerCase().includes(kw) ||
          (a.email || "").toLowerCase().includes(kw),
      )
    : all

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const list = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  async function submitCreate() {
    const name = form.name.trim()
    const wechatId = form.wechat_id.trim()
    if (!name) {
      toast.error("请输入姓名")
      return
    }
    if (!wechatId) {
      toast.error("请输入企微ID")
      return
    }
    setCreating(true)
    try {
      const res = await accountApi.create({
        account: { name, wechat_id: wechatId },
        auth: getAuth(),
      })
      if (res.success) {
        toast.success(`已注册客服「${name}」，相关会话的角色与待回复状态已自动修正`)
        setDialogOpen(false)
        setForm({ name: "", wechat_id: "" })
        await loadAll()
      } else {
        toast.error(res.message || "注册失败")
      }
    } catch (e: any) {
      toast.error(`注册失败: ${e?.message || e || ""}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value)
              setPage(1)
            }}
            placeholder="搜索姓名 / 企微ID / 邮箱"
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            <Users className="mr-1 size-3" />
            共 {all.length} 个账号{kw ? `，匹配 ${total} 个` : ""}
          </Badge>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1 size-4" />
            新增客服
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>客服</TableHead>
                  <TableHead>企微ID</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground py-12 text-center">
                      {kw ? "没有匹配的账号" : "暂无客服账号"}
                    </TableCell>
                  </TableRow>
                ) : (
                  list.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {item.name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{item.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.wechat_id || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.email}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {item.id}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-emerald-600 border-emerald-600/30 bg-emerald-600/5">
                          正常
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <ul className="divide-y p-4 md:hidden">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="py-3">
                  <Skeleton className="h-12 w-full" />
                </li>
              ))
            ) : list.length === 0 ? (
              <li className="text-muted-foreground py-8 text-center text-sm">
                {kw ? "没有匹配的账号" : "暂无客服账号"}
              </li>
            ) : (
              list.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <Avatar>
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {item.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="truncate font-mono text-xs">
                      {item.wechat_id || "—"}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {item.email}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-emerald-600 border-emerald-600/30 bg-emerald-600/5 shrink-0">
                    正常
                  </Badge>
                </li>
              ))
            )}
          </ul>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={safePage <= 1}
        >
          上一页
        </Button>
        <span className="text-muted-foreground px-2 text-sm">
          第 {safePage} / {totalPages} 页
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => p + 1)}
          disabled={safePage >= totalPages}
        >
          下一页
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新增客服账号</DialogTitle>
            <DialogDescription>
              注册后，该企微ID发送的历史消息将被识别为客服发言，相关会话的成员角色与待回复状态会自动修正。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>姓名</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="例如 lucy"
              />
            </div>
            <div className="space-y-2">
              <Label>企微ID（wechat_id）</Label>
              <Input
                value={form.wechat_id}
                onChange={(e) => setForm((f) => ({ ...f, wechat_id: e.target.value }))}
                placeholder="该客服在会话中发消息所用的企微ID"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={submitCreate} disabled={creating}>
              {creating ? "注册中…" : "注册"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
