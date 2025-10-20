FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy the application code
COPY . .

# Ensure assets directory exists (contains default logo and icon)
RUN mkdir -p /app/assets

# Expose port 3001
EXPOSE 3001

# Start the application
CMD ["npm", "start"]
