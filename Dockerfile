FROM node:22-alpine AS base

# ===== Build stage =====
FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN mkdir -p data && npm run build

# ===== Runner stage =====
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# standalone 빌드 결과 복사
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# start.js (스케줄러 래퍼)
COPY --chown=nextjs:nodejs start.js ./

# node-cron (start.js에서 사용, standalone에 미포함)
RUN npm install node-cron

# DB 파일용 디렉토리
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["node", "start.js"]
