FROM oven/bun:1
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages ./packages
COPY apps ./apps
RUN bun install 2>&1 | tail -20
EXPOSE 3000
CMD ["bun", "apps/api/src/index.ts"]
