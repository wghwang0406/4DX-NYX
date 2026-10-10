# NYX 사내 뷰어 서버 — 모노레포 루트에서:  docker build -f apps/viewer/Dockerfile -t nyx-viewer .
FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY apps/viewer/package.json apps/viewer/
RUN corepack pnpm install --filter @conti/viewer --frozen-lockfile
COPY apps/viewer apps/viewer
RUN corepack pnpm --filter @conti/viewer build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NYX_DATA=/data NYX_PORT=8787 NYX_HOST=0.0.0.0 NODE_NO_WARNINGS=1
COPY --from=build /src/apps/viewer/dist/server.mjs ./server.mjs
COPY --from=build /src/apps/viewer/dist/web ./web
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
