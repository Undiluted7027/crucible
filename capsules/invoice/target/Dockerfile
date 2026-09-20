FROM node:20.19.5-bookworm-slim@sha256:9e70124bd00f47dd023e349cd587132ae61892acc0e47ed641416c3e18f401c3 AS build

WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
RUN npm run build

FROM node:20.19.5-bookworm-slim@sha256:9e70124bd00f47dd023e349cd587132ae61892acc0e47ed641416c3e18f401c3

LABEL org.opencontainers.image.title="Crucible invoice capsule target" \
      org.opencontainers.image.source="https://github.com/Undiluted7027/crucible" \
      dev.crucible.capsule="invoice-lodash-template-imports" \
      dev.crucible.revision="vulnerable"

ENV NODE_ENV=production \
    PORT=3000

RUN groupadd --gid 10001 crucible \
    && useradd --uid 10001 --gid crucible --create-home --shell /bin/sh crucible

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force
COPY --from=build --chown=crucible:crucible /build/dist ./dist
RUN chown -R crucible:crucible /workspace /home/crucible

EXPOSE 3000
USER crucible
CMD ["node", "dist/server.js"]

