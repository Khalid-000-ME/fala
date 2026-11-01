# Build context is the repo root: the server imports shared DKIM and mail code from worker/src.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# tsx runs the TypeScript sources directly, and it is a devDependency, so install everything.
COPY server/package.json server/package-lock.json server/
# npm ci is strict about an optional peer (utf-8-validate) the lockfile never recorded.
# --include=dev is required: NODE_ENV=production would drop tsx, which runs the server.
RUN cd server && npm install --include=dev --no-audit --no-fund

COPY server server
COPY worker/src worker/src

EXPOSE 8787
CMD ["npm", "--prefix", "server", "start"]
