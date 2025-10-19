FROM node:20-alpine
WORKDIR /app
EXPOSE 3003
CMD ["node", "src/index.js"]

# Copy package.json and prisma schema first
COPY package*.json prisma/ ./

# Install dependencies
RUN npm install --production

# Generate Prisma Client
RUN npx prisma generate

# Copy the rest of the code
COPY . .