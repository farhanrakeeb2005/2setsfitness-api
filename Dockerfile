# 2SetsFitness API for Cloud Run (or any container host).
# Build/deploy: gcloud run deploy --source .   (see DEPLOY.md)
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# dependencies first, so a code-only change reuses this layer
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

# the official image's unprivileged user
USER node

# Cloud Run sets PORT (8080); server.js listens on it
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
