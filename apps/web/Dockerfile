# Multi-stage build for apps/web. Run from the REPO ROOT:
#   docker build -f apps/web/Dockerfile -t workpulse-web .

FROM node:20-alpine AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build -w apps/web

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/.next ./apps/web/.next
COPY --from=build /repo/apps/web/public ./apps/web/public
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/web/package.json ./apps/web/package.json
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "apps/web"]
