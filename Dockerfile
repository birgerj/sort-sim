# The game and its server in one image: the built site, and the server that serves it and
# scores plans. Scores live in /data (mount a volume there).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA=/data SITE=/app/dist TRUST_PROXY=1 RUN_AS=1000:1000
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server/server.mjs ./server.mjs
# Starts as root only to take over the mounted data folder, then goes on as the node user.
RUN mkdir -p /data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server.mjs"]
