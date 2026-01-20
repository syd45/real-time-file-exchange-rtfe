FROM node:18-alpine

WORKDIR /app

# 安装系统依赖，包括用于调试的工具
RUN apk add --no-cache curl dumb-init bash util-linux

# 复制package文件并安装依赖
COPY package*.json ./
RUN npm install --production && npm cache clean --force

# 复制应用代码
COPY . .

# 设置健康检查，确保服务正常运行
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

EXPOSE 3000

# 使用dumb-init作为PID 1进程，更好地处理信号
ENTRYPOINT ["dumb-init", "--"]

CMD ["npm", "run", "pm2-start"]