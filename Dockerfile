FROM node:22-alpine

RUN apk add --no-cache tini

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

EXPOSE 3000
CMD ["tini", "--", "npm", "run", "start"]
