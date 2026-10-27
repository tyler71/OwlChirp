# Build context is the parent directory (new/) so both frontend and backend are available:
#   docker build -f backend/Dockerfile .

FROM node:24-slim AS frontend
WORKDIR /build

RUN corepack enable

COPY frontend/package.json frontend/pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY frontend/ ./

RUN pnpm build


FROM golang:1.26 AS backend
ARG VERSION=unknown
WORKDIR /build

COPY backend/go.mod backend/go.sum backend/build.sh ./

RUN go mod download

COPY backend/app/ ./app/
COPY --from=frontend /build/dist/ ./app/assets/web/

RUN NO_COMPRESS=1 VERSION=$VERSION ./build.sh linux/amd64 \
 && mv build/owlchirp-linux-amd64* server


FROM debian:12-slim AS prod
LABEL authors="Tyler Yeager"

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 1000 application \
 && useradd --uid 1000 --gid 1000 --system --no-create-home application \
 && mkdir /data && chown application:application /data

COPY --from=backend /build/server /usr/local/bin/owlchirp

USER application
ENV APP_PORT=4444 \
    DB_DSN=/data/owlchirp.sqlite3
VOLUME /data
EXPOSE 4444

ENTRYPOINT ["/usr/local/bin/owlchirp"]
