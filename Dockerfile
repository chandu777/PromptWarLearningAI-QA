# Stage 1: Build the optimized React frontend
FROM node:18-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm install

# Copy the source code
COPY . .

# Build the frontend. The API key is NO LONGER needed here for security!
RUN npm run build

# Stage 2: Create the Secure Production Environment
FROM node:18-alpine

WORKDIR /app

# Only install production backend dependencies for efficiency and security
COPY package*.json ./
RUN npm install --omit=dev

# Copy backend logic
COPY server.js ./

# Copy optimized frontend assets from Stage 1
COPY --from=build /app/dist ./dist

# Security: Run as a non-root user
USER node

# Port expected by Google Cloud Run
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
