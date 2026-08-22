# Build stage
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the application code
COPY . .

# Typecheck-Ratsche: `vite build` (esbuild) entfernt Typen, ohne sie zu prüfen —
# echte Fehler sind so bereits unbemerkt in Produktion gelangt. Die Ratsche lässt
# den bestehenden Alt-Bestand zu und schlägt nur fehl, wenn NEUE Typfehler
# hinzukommen. Baseline: .typecheck-baseline
RUN npm run typecheck:ratchet

# Unit-Tests der Geld-/Steuerlogik (Beträge, Rabatte, Kleinunternehmerregelung).
# Läuft in wenigen hundert Millisekunden und verhindert, dass fehlerhafte
# Rechnungsbeträge deployt werden.
RUN npm test

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy the built application from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
