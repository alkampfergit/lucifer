FROM node:22-alpine AS build

WORKDIR /app

# better-sqlite3 needs build tools for native compilation
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# better-sqlite3 native module needs these at runtime
RUN apk add --no-cache libstdc++

COPY package*.json ./
RUN apk add --no-cache python3 make g++ && \
    npm ci --omit=dev && \
    apk del python3 make g++

COPY --from=build /app/dist ./dist

# Default config and data directories (mount volumes here)
RUN mkdir -p /app/config /app/data

EXPOSE 3001

# Default: start the server with config from /app/config
CMD ["node", "dist/server/cli.js", "--config", "/app/config/lucifer.json"]
