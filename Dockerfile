# Use lightweight Node.js LTS base
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /usr/src/app

# Copy package manifests first for caching
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src ./src

# Expose service port
EXPOSE 8080

# Run the service
CMD ["node", "src/app.js"]
