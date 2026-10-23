FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
# .wasm needs the right MIME type for streaming compile; Caddy serves it correctly
CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":80"]
