FROM python:3.10-slim AS init

HEALTHCHECK --interval=5m --timeout=3s \
  CMD curl -I 127.0.0.1:8080/ping || exit 1

RUN apt-get update && apt-get install -y \
    curl \
 && rm -r /var/lib/apt/lists/* \
 && apt-get clean

RUN mkdir /app /data               \
 && groupadd application           \
      --gid 1000                   \
 && useradd application            \
      --base-dir /app              \
      --home-dir /home/application \
      --create-home                \
      --uid 1000                   \
      --gid 1000                   \
      --system

# This stage installs all the requirements for the main app.
# This will be copied later to the production stage
FROM init AS build_server_environment
COPY ./requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt

FROM node:lts AS build_client_environment
# When run in prod, the webpack configuration puts built assets in ./dist
# So this should be in /build/dist/
# build args CONNECT_INSTANCE and TIME_ZONE are required
ARG CONNECT_DOMAIN
ARG CONNECT_INSTANCE
ARG TIME_ZONE
WORKDIR /build

COPY ./app/client /build

RUN npm install
RUN npm run prod

# caddy handles http/s termination. It is built from scratch
# This allows for additional modules later if we need it.
FROM caddy:2.6.2-builder AS build_reverse_proxy
ENV XCADDY_SKIP_CLEANUP=1
ENV BUILD_VERSION=v2.6.2

RUN xcaddy build $BUILD_VERSION

RUN mkdir -p /opt/reverse_proxy  \
&& mv /usr/bin/caddy /opt/reverse_proxy/caddy

# Copy files from previous stages
# We also copy in config files
# A application user is created. While the image doesn't force non-root
# Supervisor later on drops root for all apps it handles
FROM init AS production

ARG SET_GIT_SHA=dev
ARG SET_BUILD_NUMBER=9999

ENV GIT_SHA=$SET_GIT_SHA

LABEL GIT_SHA=$SET_GIT_SHA
LABEL BUILD_NUMBER=$SET_BUILD_NUMBER

ENV TZ="America/Los_Angeles"

ENV DATA_DIR /data

COPY --from=build_reverse_proxy      /opt/reverse_proxy /opt/reverse_proxy
COPY --from=build_server_environment /usr/local         /usr/local
COPY --from=build_client_environment /build/dist        /app/server/static/dist

RUN python -m pip install --no-cache-dir install supervisor

COPY ./config/init/supervisord.conf   /etc/supervisord.conf
COPY ./config/init.sh                 /init.sh
COPY ./config/reverse_proxy/Caddyfile /etc/Caddyfile

EXPOSE 8080

COPY --chown=application:application ./app /app

CMD bash /init.sh
