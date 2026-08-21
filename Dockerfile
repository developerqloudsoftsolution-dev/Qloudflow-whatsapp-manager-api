FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

# Invalidate cache
LABEL version="2.0.1"
COPY . .

# Create volume for auth_info to persist sessions
VOLUME [ "/app/auth_info" ]

EXPOSE 3000

CMD ["node", "server.js"]
