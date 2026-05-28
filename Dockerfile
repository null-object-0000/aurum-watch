FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

FROM deps AS build
COPY . .
RUN bun run build
RUN bunx tsc -p tsconfig.server.json

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production

# Install Python, pip, and venv to run aktools
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*

# Setup virtual environment and install aktools
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip3 install --no-cache-dir aktools

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY package.json ./

# Copy entrypoint script and make it executable
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 8787
EXPOSE 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]
