# ----------------------
# Stage 1: Build stage
# ----------------------
FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies 
COPY package*.json ./
RUN npm install

# Copy the rest of the app
COPY . .

# Optional: if you have a build step 
# RUN npm run build


# ----------------------
# Stage 2: Runtime stage
# ----------------------
FROM node:18-alpine

WORKDIR /app

# Copy only package.json + package-lock.json (if exists)
COPY package*.json ./

# Install only production dependencies
RUN npm install --only=production

# Copy app code from builder
COPY --from=builder /app ./

# If your app was built (React, NestJS dist, etc.):
# COPY --from=builder /app/dist ./dist

# HealtCheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); \
    const options = { host: 'localhost', port: process.env.PORT || 3000, path: '/health', timeout: 2000 }; \
    const request = http.request(options, (res) => { \
      if (res.statusCode === 200) { process.exit(0); } else { process.exit(1); } \
    }); \
    request.on('error', () => process.exit(1)); \
    request.end();"

EXPOSE 8080

CMD ["npm", "start"]
