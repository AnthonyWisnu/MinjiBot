# ==========================================
# Multi-Stage Dockerfile for MinjiBot
# ==========================================

# Stage 1: Build & Compile TypeScript
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
COPY tsconfig*.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies) & generate Prisma client
RUN npm ci && npx prisma generate

# Copy source code and build
COPY src ./src/
COPY assets ./assets/
RUN npm run build && npm prune --omit=dev

# Stage 2: Minimal Production Runtime
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install system dependencies: FFmpeg, Python (for yt-dlp & gallery-dl), fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && pip3 install --no-cache-dir --break-system-packages gallery-dl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# Copy built application and production dependencies
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/assets ./assets
COPY ecosystem.config.cjs ./

# Setup data and temp directories with non-root user permissions
RUN mkdir -p /app/sessions /app/tmp \
    && chown -R node:node /app

USER node

CMD ["node", "dist/index.js"]
