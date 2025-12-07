FROM node:22-bullseye

WORKDIR /usr/src/app

# Copia package.json e instala deps
COPY package*.json ./
RUN npm install

# Copia o restante do código
COPY serverless.yml ./
COPY src ./src

# Expor a porta do serverless-offline
EXPOSE 3000

CMD ["npm", "run", "dev"]