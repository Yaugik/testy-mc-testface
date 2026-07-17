FROM mcr.microsoft.com/playwright:v1.59.1-noble

RUN apt-get update \
    && apt-get install -y --no-install-recommends docker.io ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /workspace

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

EXPOSE 3000 3100 8080

CMD ["sh", "-c", "pnpm --filter @testy/control-plane migrate:prod && pnpm --filter @testy/control-plane start"]
