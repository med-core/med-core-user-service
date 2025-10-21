FROM node:20-alpine
WORKDIR /app
EXPOSE 3002

ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL 

COPY package*.json prisma/ ./

RUN npm install --production

RUN apk add --no-cache curl

RUN npx prisma generate

ENV DATABASE_URL= 

COPY . .
CMD ["node", "src/index.js"]
