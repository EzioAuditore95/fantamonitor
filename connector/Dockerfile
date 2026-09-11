FROM mcr.microsoft.com/playwright:v1.55.0-noble

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs ./
COPY phase1-patch.mjs ./
COPY phase2-patch.mjs ./

ENV NODE_ENV=production
CMD ["npm", "start"]
