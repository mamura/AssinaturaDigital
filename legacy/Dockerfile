FROM node:22-bullseye

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci || npm install

RUN npm install -g serverless

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]