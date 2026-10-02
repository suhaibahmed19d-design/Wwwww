# Base image: Node.js 22 LTS (Slim)
FROM node:22-slim

# Install FFmpeg and essential media utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install all dependencies (including build tools)
RUN npm install

# Copy application source code
COPY . .

# Build the React/Vite frontend for production
ENV NODE_ENV=production
RUN npm run build

# Default environment port (overridden by platform dynamically)
ENV PORT=3000
EXPOSE 3000

# Start server using npm start
CMD ["npm", "start"]
