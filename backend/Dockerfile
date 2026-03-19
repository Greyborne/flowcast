FROM node:20-slim
WORKDIR /app

# Install OpenSSL — required by Prisma engine binaries
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

COPY . .

EXPOSE 3001
CMD ["npm", "run", "dev"]
