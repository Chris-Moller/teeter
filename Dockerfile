FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY server.js ./
COPY public/ ./public/

# SQLite database is stored in /app/data. For persistence across container
# restarts and redeployments, mount a persistent volume at /app/data:
#   docker run -v teeter-data:/app/data -p 8080:8080 teeter
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8080
CMD ["node", "server.js"]
