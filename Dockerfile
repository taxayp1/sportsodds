FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app


RUN apt-get update \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/*


RUN groupadd --gid 1001 nodeapp \
    && useradd --uid 1001 --gid nodeapp --shell /bin/bash --create-home nodeapp

COPY package*.json ./
RUN npm install --omit=dev


COPY server.js cronFetch.js db.js betfairExchange.js ./
COPY racingFetch.js db-racing.js racingBookies.js ./

COPY public/ ./public/

RUN chown -R nodeapp:nodeapp /app

USER nodeapp

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/cache-bust', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]