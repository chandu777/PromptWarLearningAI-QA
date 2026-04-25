# Stage 1: Build the React Application
FROM node:18-alpine as build

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# Build the Vite application (This will bake the VITE_ variables into the JS files)
RUN npm run build

# Stage 2: Serve the application with Nginx
FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom nginx config for Google Cloud Run compatibility
COPY nginx.conf /etc/nginx/conf.d/

# Copy the build output from Stage 1
COPY --from=build /app/dist /usr/share/nginx/html

# Expose port 8080 (Standard for Google Cloud Run)
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
