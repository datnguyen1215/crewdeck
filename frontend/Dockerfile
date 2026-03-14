FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

ENV HOST=127.0.0.1
ENV PORT=9380

EXPOSE 9380

CMD ["node", "build"]
