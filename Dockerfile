# The game and its server in one image: the built site, and the server that serves it and
# scores plans. Scores live in /data (mount a volume there).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA=/data SITE=/app/dist TRUST_PROXY=1
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server/server.mjs ./server.mjs
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.mjs"]
