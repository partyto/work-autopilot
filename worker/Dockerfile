FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./

ENV NODE_ENV=production
ENV SESSION_DIR=/app/sessions

RUN mkdir -p /app/sessions

EXPOSE 3200

CMD ["node", "server.js"]
