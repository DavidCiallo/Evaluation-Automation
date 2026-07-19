import { useEffect, useState } from "react"
import { Users } from "lucide-react"

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/client/components/ui/card"
import { Avatar, AvatarFallback } from "@/client/components/ui/avatar"
import { Badge } from "@/client/components/ui/badge"
import { Skeleton } from "@/client/components/ui/skeleton"
import { Button } from "@/client/components/ui/button"
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
}

export function AccountPage() {
  const [list, setList] = useState<AccountItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const res = await accountApi.list({ page, auth: getAuth() })
    if (res.success) {
      setList(res.data?.list || [])
      setTotal(res.data?.total || 0)
    } else {
      toast.error(res.message || "Failed to load")
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [page])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Accounts</h2>
          <p className="text-muted-foreground text-sm">
            Users registered in your workspace.
          </p>
        </div>
        <Badge variant="secondary">
          <Users className="mr-1 size-3" />
          {total} total
        </Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={4}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground py-12 text-center">
                      No accounts yet
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
                      <TableCell className="text-muted-foreground">
                        {item.email}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {item.id}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-emerald-600 border-emerald-600/30 bg-emerald-600/5">
                          Active
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
                No accounts yet
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
                    <p className="text-muted-foreground truncate text-xs">
                      {item.email}
                    </p>
                    <p className="text-muted-foreground truncate font-mono text-[10px]">
                      {item.id}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-emerald-600 border-emerald-600/30 bg-emerald-600/5 shrink-0">
                    Active
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
          disabled={page === 1}
        >
          Prev
        </Button>
        <span className="text-muted-foreground px-2 text-sm">Page {page}</span>
        <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}
