FROM python:3.10-slim AS init

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

# This stage installs all the requirements for the main app to /usr/local.
# This will be copied later to the production stage
FROM init AS build_server_environment
COPY ./requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt

FROM node:18.14-slim AS build_client_environment
# When run in prod, the webpack configuration puts built assets in ./dist
# So this should be in /build/dist/
# build args CONNECT_INSTANCE and TIME_ZONE are required
ARG CONNECT_DOMAIN
ARG CONNECT_INSTANCE
ARG TIME_ZONE
ARG TELEMETRY_URL

WORKDIR /build

COPY ./app/client /build

RUN npm install
RUN npm run prod

# caddy handles http/s termination. It is built from scratch
# We are using it as a standardized reverse proxy to the app.
# This also allows for additional modules later if we need it.
FROM caddy:2.6.2-builder AS build_reverse_proxy
ENV XCADDY_SKIP_CLEANUP=1
ENV BUILD_VERSION=v2.6.2

RUN xcaddy build $BUILD_VERSION

RUN mkdir -p /opt/reverse_proxy  \
&& mv /usr/bin/caddy /opt/reverse_proxy/caddy

# Copy files from previous stages
# We also copy in config files
# While the image doesn't force non-root, Supervisor drops root for all apps it handles
# We also label the sha and build number. This causes Docker Swarm to notice it is a different image.
FROM init AS production

ARG SET_GIT_SHA=dev
ARG SET_BUILD_NUMBER=9999

ENV GIT_SHA=$SET_GIT_SHA

LABEL GIT_SHA=$SET_GIT_SHA
LABEL BUILD_NUMBER=$SET_BUILD_NUMBER

ENV TZ=$TIME_ZONE

ENV DATA_DIR /data

RUN python -m pip install --no-cache-dir install supervisor

COPY ./config/init/supervisord.conf   /etc/supervisord.conf
COPY ./config/init.sh                 /init.sh
COPY ./config/reverse_proxy/Caddyfile /etc/Caddyfile

EXPOSE 8080

COPY --from=build_reverse_proxy      /opt/reverse_proxy /opt/reverse_proxy
COPY --from=build_client_environment /build/dist        /app/server/static/dist
COPY --from=build_server_environment /usr/local         /usr/local

COPY --chown=application:application ./app /app

CMD bash /init.sh
