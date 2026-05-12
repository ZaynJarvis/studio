FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json server.mjs ./
COPY --from=build /app/dist ./dist

EXPOSE 3000

CMD ["npm", "run", "start"]
