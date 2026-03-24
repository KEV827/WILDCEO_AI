FROM node:20-alpine

WORKDIR /app

# Copy and install backend dependencies
COPY backend/package.json backend/
RUN cd backend && npm install --production

# Copy application code
COPY backend/ backend/
COPY frontend/ frontend/

# Create data directory
RUN mkdir -p /data

# Non-root user
RUN addgroup -g 1000 wildceo && adduser -u 1000 -G wildceo -s /bin/sh -D wildceo
RUN chown -R wildceo:wildceo /app /data
USER wildceo

EXPOSE 3777

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3777/api/health || exit 1

CMD ["node", "backend/server.js"]
