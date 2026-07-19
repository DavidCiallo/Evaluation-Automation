FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

RUN mkdir -p data

EXPOSE 3300

CMD ["bun", "run", "server/app/index.ts"]
