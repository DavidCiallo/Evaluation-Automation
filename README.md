# Evaluation-Automation

签证业务自动化中枢：React 前端 + Bun 后端的单体全栈应用。
以「会话 → 订单 → 申请单 → 表单/材料/行程」为主干，对接五个自研外围系统（简表、麦客、ctrip、NW邮箱、确认单）与企小码会话源。

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

Server runs at http://localhost:2900（端口由 `SERVER_PORT` 决定，默认 2900，与 rsbuild 代理目标一致）。

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
即 `data/app.db`）。可配置项包括服务地址、登录账号/口令、启用开关、轮询间隔，
以及会话源的消息源（企微 SDK / 企小码）与 SDK 地址。

**优先级：界面设置 > 环境变量 > 内置默认值。** 环境变量只是首次部署的默认值；
界面里「恢复默认」会清掉该项的库内设置，退回读环境变量。

| 系统 | 环境变量（兜底） | 用途 |
|---|---|---|
| 简表 survey | `TYPEFORM_*` | NW表单：发链接收集客户信息、回查、取数 |
| 麦客 mike | `MIKE_*` | 表单捕获：按「表单+姓名」匹配站外提交 |
| ctrip | `CTRIP_*` | 机票任务：提交乘客护照 → 同步状态 → 产物 PDF 挂申请单材料 |
| NW邮箱 email | `EMAIL_*` | 邮件中心（收发/附件/AI 摘要与起草）、订单发材料、收件自动关联客户 |
| 确认单 contract | `CONTRACT_*` | 把客户资料整理成带签署链接的确认单，客户回签后解锁「信息确认」阶段 |
| 企小码 chat | `QIXIOMA_BASE_URL` | 会话源（消息源切到「企小码」后从该地址增量拉取） |
| 企微 SDK | `SDK_HOST / POLL_INTERVAL_MS / SYNC_POLLER / SYNC_SOURCE` | 会话摄入来源与开关 |

留空提交表示保持原值。改完设置在界面保存即生效，后台任务会自动重启，无需重启进程。
ctrip 与麦客、邮箱一样需要鉴权：登录后 token 内存缓存，失效自动重登，
改地址或密码会作废旧 token。

确认单的签署状态**以服务端为准**。

订单详情页三栏流程：

1. **表单收集**：简表（发链接）/ 麦客（匹配提交）双源分配 → 查看客户填写内容
2. **机票/行程**：ctrip 机票任务（申请单护照预填）→ 产物 PDF 一键挂材料；手动行程单（AI 生成）作为兜底
3. **发材料邮件**：勾选申请单材料 → AI 起草正文 → 发送（收件自动关联客户档案）

## 订单阶段与动作准入

订单进度不再是一个可以手工修改的状态字段，而是**由业务证据实时推导的阶段视图**
（`shared/modules/order/stage.ts` 定义模型，`server/modules/order/stage.service.ts` 负责计算）。

阶段依次为：订单信息 → 表单收集 → 信息确认 → 账号分配 → 注册填表 → 行程安排 → 机票办理 → 材料制作 → 完结。
每阶段的就绪条件来自既有数据，例如：

| 阶段 | 就绪条件 |
|---|---|
| 订单信息 | 客户名单至少一位，且姓名/签证类型/出发地/目的地齐备 |
| 表单收集 | 每位客户都已分配表单 |
| 信息确认 | 每位客户的信息确认单都已回签 |
| 账号分配 | 账号池已为每位客户分配账号并派发注册任务 |
| 行程安排 | 客户资料齐全 + **客户已同意** + 已生成行程或机票任务 |
| 机票办理 | 每位乘客的证件与联系人信息齐备 |
| 材料制作 | 各申请单的必备材料行均已收到 |
| 完结 | 所有申请单已出签/拒签/取回/取消 |

要点：

- **状态不可手工推进**。推进靠完成对应业务动作；`/api/order/transition` 仅保留
  取消（`cancelled`）语义，其余目标会返回引导信息。整单取消走 `/api/order/cancel`
  （需填原因），可用 `/api/order/reopen` 恢复。
- **动作准入**由内核统一拦截：每个插件动作通过 `actionGates` 声明所属阶段与所需准入项，
  不满足即拒绝并回报具体缺口（如「需先完成『表单收集』阶段：缺少 1 位客户的表单」）。
- **可选阶段可豁免**：机票、材料等阶段若不适用于本单，客服可填写原因后跳过
  （`waive-stage`），留痕可审计；必经阶段不可跳过。
- 读路径不做任何状态回写，列表/详情/指标统一使用同一份投影，避免口径不一致。

## 部署

后端 `Bun.serve` 同时提供 API 和 `dist/` 静态文件，**只需一个进程、一个端口**，

### 方式一：直接跑（推荐，本机/裸服务器）

```bash
bun install
bun run build          # 产出 dist
cp .env.example .env   # 按需填写
bun run serve          # 默认 2900
```

生产环境建议用进程守护，崩溃自动拉起。用 systemd 的话：

```ini
[Unit]
Description=Evaluation-Automation
After=network.target

[Service]
WorkingDirectory=/opt/Evaluation-Automation
ExecStart=/root/.bun/bin/bun run server/app/index.ts
Restart=always
User=root
EnvironmentFile=/opt/Evaluation-Automation/.env

[Install]
WantedBy=multi-user.target
```

`WorkingDirectory` 必须是仓库根目录：`data/app.db` 与 `dist/` 都按相对路径解析，
换目录会另起一个空库。

### 方式二：Docker

```bash
bun run build          # 可选，镜像内会自己 build
docker compose up -d --build
```

容器内固定监听 2900，对外端口由 compose 的 `HOST_PORT` 决定（默认 2900）：

```bash
HOST_PORT=8080 docker compose up -d --build
```

> 注意：Dockerfile 与 compose 我改过端口映射（原先镜像内 3300、
> 而 `.env` 的 `SERVER_PORT=2900` 会让容器实际监听 2900，对外映射 3300 就连不上）。
> 本机没有 Docker，**这个修正未经实机构建验证**——首次部署请确认容器起来后
> 宿主机 `curl http://localhost:2900/` 有响应。

### 必须注意的三件事

1. **数据都在 `data/`**：SQLite 库（`app.db`）与上传附件都在这里，被 gitignore。
   迁移机器时整个目录一起搬。首次启动会自动建库，老数据（`data/*.jsonl`）
   启动时自动迁移，也可手动 `bun run migrate`。
2. **`SECRET` 必须换掉**，它用来签发登录 token。`.env.example` 里的是示例值。
3. **外围系统的口令建议改到界面里维护**（系统配置 → 外围系统接入，落库到 `data/app.db`），
   `.env` 只作首次部署的默认值。优先级：界面设置 > 环境变量 > 内置默认值。

### 反向代理（可选）

如果要挂域名 + HTTPS，把整个站点反代到 2900 即可，API 和页面同源，无需额外配置。
注意两处：`idleTimeout` 已放宽到 255 秒（AI 生成类接口较慢），

## Layout

```
server/      backend (Bun.serve + modules)
client/      React frontend
shared/      types & route contracts shared by client/server
scripts/     迁移 / 演示数据 / 冒烟脚本
data/        SQLite (app.db) + media 附件（gitignored，仅保留 .gitkeep）
```
