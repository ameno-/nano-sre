FROM node:20-slim AS build

WORKDIR /app

COPY package.json tsconfig.json /app/
COPY src /app/src

RUN npm install --no-audit --no-fund
RUN npm run build

FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist

EXPOSE 8790

CMD ["node", "dist/server.js"]
