FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

RUN mkdir -p data

# 容器内端口固定 2900，与 rsbuild 代理目标、SERVER_PORT 默认值一致。
# 对外映射到哪个端口由 docker-compose 决定，不要靠改这里。
ENV SERVER_PORT=2900
EXPOSE 2900

CMD ["bun", "run", "server/app/index.ts"]
