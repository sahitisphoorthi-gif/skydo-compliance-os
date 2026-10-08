FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p uploads
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "npm run init-db && npm start"]
