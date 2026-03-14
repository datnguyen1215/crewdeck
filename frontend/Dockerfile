FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# No EXPOSE — we use network_mode: host, so the port is bound directly on the host.
CMD ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", "9380"]
