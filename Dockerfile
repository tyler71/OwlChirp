FROM python:3.10-slim AS init

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
FROM python:3.10-slim AS build_app_environment
COPY ./requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt

FROM node:18.14.2 AS build_js_dist
ARG CONNECT_DOMAIN
ARG TIME_ZONE=America/Los_Angeles

COPY ./app/client /assets
WORKDIR /assets

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
ENV GIT_SHA=$SET_GIT_SHA
ENV TZ="America/Los_Angeles"


COPY --from=build_reverse_proxy   /opt/reverse_proxy     /opt/reverse_proxy
COPY --from=build_app_environment /usr/local             /usr/local

RUN python -m pip install --no-cache-dir install supervisor


COPY ./config/init/supervisord.conf   /etc/supervisord.conf
COPY ./config/init.sh                 /init.sh
COPY ./config/reverse_proxy/Caddyfile /etc/Caddyfile

EXPOSE 8080
EXPOSE 4443

COPY --from=build_js_dist            /assets/dist /app/server/static/dist
COPY --chown=application:application ./app        /app

CMD bash /init.sh