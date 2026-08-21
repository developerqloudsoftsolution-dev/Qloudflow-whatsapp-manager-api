FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Create volume for auth_info to persist sessions
VOLUME [ "/app/auth_info" ]

EXPOSE 3000

CMD ["node", "server.js"]
