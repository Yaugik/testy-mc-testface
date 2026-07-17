FROM node:24-alpine

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /workspace

COPY . .

RUN pnpm install --no-frozen-lockfile
RUN pnpm build

EXPOSE 3000 3100

CMD ["sh", "-c", "pnpm --filter @testy/control-plane migrate:prod && pnpm --filter @testy/control-plane start"]
