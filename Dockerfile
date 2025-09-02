# ----------------------
# Stage 1: Build stage
# ----------------------
FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies (only for build stage)
COPY package*.json ./
RUN npm install

# Copy the rest of the app
COPY . .

# Optional: if you have a build step (React, NestJS, etc.)
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

EXPOSE 8080

CMD ["npm", "start"]
