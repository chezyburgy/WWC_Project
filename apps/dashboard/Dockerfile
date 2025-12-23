FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.json vite.config.ts index.html tailwind.config.js postcss.config.js /app/
COPY src /app/src
COPY public /app/public
RUN npm install
ENV VITE_API_BASE=${VITE_API_BASE}
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
