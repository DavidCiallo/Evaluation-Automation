# Evaluation-Automation

签证业务自动化中枢：React 前端 + Bun 后端的单体全栈应用。
以「会话 → 订单 → 申请单 → 表单/材料/行程」为主干，对接四个自研外围系统（简表、麦客、ctrip、NW邮箱）与企小码会话源。

## Stack

- Frontend: React + rsbuild
- Backend: Bun
- Storage: SQLite（bun:sqlite，`data/app.db`；`STORE_DRIVER=jsonl` 可回退旧文件存储）
- LLM: OpenAI 兼容协议（`LLM_BASE_URL / LLM_API_KEY / LLM_MODEL`）

## Quick start

```bash
npm install -g bun
bun install
cp .env.example .env
bun run serve
```

Server runs at http://localhost:3300.

老数据（data/*.jsonl）在启动时自动迁移到 SQLite；也可手动执行 `bun run migrate`。

## Scripts

- `bun run dev` — start frontend dev server (hot reload)
- `bun run build` — build frontend into `dist/`
- `bun run serve` — run backend (serves API + built static files)
- `bun run migrate` — migrate legacy `data/*.jsonl` into SQLite
- `bun run reset` — wipe `data/` and run backend

## 外围系统集成

四个外围系统与会话源的入口都在界面上维护：**系统配置 → 外围系统接入**
（`server/lib/integration-settings.ts` 解析，落库到 `Config` 集合的 `integrations` 键，
即 `data/app.db`，不入仓库）。可配置项包括服务地址、登录账号/口令、启用开关、轮询间隔，
以及会话源的消息源（企微 SDK / 企小码）与 SDK 地址。

**优先级：界面设置 > 环境变量 > 内置默认值。** 环境变量只是首次部署的默认值；
界面里「恢复默认」会清掉该项的库内设置，退回读环境变量。

| 系统 | 环境变量（兜底） | 用途 |
|---|---|---|
| 简表 survey | `TYPEFORM_*` | NW表单：发链接收集客户信息、回查、取数 |
| 麦客 mike | `MIKE_*` | 表单捕获：按「表单+姓名」匹配站外提交，AI 转录入申请单 |
| ctrip | `CTRIP_*` | 机票任务：提交乘客护照 → 同步状态 → 产物 PDF 挂申请单材料 |
| NW邮箱 email | `EMAIL_*` | 邮件中心（收发/附件/AI 摘要与起草）、订单发材料、收件自动关联客户 |
| 企小码 chat | `QIXIOMA_BASE_URL` | 会话源（消息源切到「企小码」后从该地址增量拉取） |
| 企微 SDK | `SDK_HOST / POLL_INTERVAL_MS / SYNC_POLLER / SYNC_SOURCE` | 会话摄入来源与开关 |

口令类字段不回传明文：接口只返回 `has_secret` 与来源（`settings` / `env`），
留空提交表示保持原值。改完设置在界面保存即生效，后台任务会自动重启，无需重启进程。

订单详情页三栏流程：

1. **表单收集**：简表（发链接）/ 麦客（匹配提交）双源分配 → AI 校验数据完整性与自洽 → AI 转录回填申请单
2. **机票/行程**：ctrip 机票任务（申请单护照预填）→ 产物 PDF 一键挂材料；手动行程单（AI 生成）作为兜底
3. **发材料邮件**：勾选申请单材料 → AI 起草正文 → 发送（收件自动关联客户档案）

## Layout

```
server/      backend (Bun.serve + modules)
client/      React frontend
shared/      types & route contracts shared by client/server
scripts/     迁移 / 演示数据 / 冒烟脚本
data/        SQLite (app.db) + media 附件（gitignored，仅保留 .gitkeep）
```
