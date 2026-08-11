FROM node:24-alpine

RUN apk add --no-cache tini

WORKDIR /app

# Install dependencies, without the ones only needed to lint and test
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the rest of the application code
COPY . .

EXPOSE 3000
CMD ["tini", "--", "npm", "run", "start"]
