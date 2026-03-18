FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

COPY . .

EXPOSE 3001
CMD ["npm", "run", "dev"]
