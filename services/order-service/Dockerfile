FROM node:20-alpine
WORKDIR /app
# copy full workspace for simplicity
COPY . .
RUN npm install && npm run build
CMD ["node", "services/order-service/dist/index.js"]
