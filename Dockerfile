FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV PLAYWRIGHT_B ROWSERS_PATH=/ms-playerwright
ENV SHOW_BROWSER=false

CMD ["node", "src/index.js"]
