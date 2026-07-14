FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8788 DATA_DIR=/data
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
VOLUME /data
EXPOSE 8788
USER node
CMD ["node", "server/dist/main.js"]
