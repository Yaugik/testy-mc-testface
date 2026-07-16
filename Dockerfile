FROM node:24-alpine

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /workspace

COPY package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .prettierrc.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY apps/control-plane/package.json apps/control-plane/package.json

RUN pnpm install --no-frozen-lockfile

COPY . .

RUN pnpm build

EXPOSE 3000

CMD ["sh", "-c", "pnpm --filter @testy/control-plane migrate:prod && pnpm --filter @testy/control-plane start"]
