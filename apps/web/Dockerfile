FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages ./packages
COPY apps ./apps
RUN bun install
RUN bun run --filter @lunixpanel/web build
FROM nginx:alpine
RUN apk add --no-cache openssl
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/docker-entrypoint.sh /docker-entrypoint.d/40-panel-certs.sh
RUN chmod +x /docker-entrypoint.d/40-panel-certs.sh
EXPOSE 80 443
