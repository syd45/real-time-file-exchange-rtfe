#!/bin/bash

# SDAV Docker启动脚本
# 包含清除构建缓存和重新构建的功能

echo "======= SDAV Docker启动脚本 ======="

# 停止并移除现有的容器
echo "停止现有容器..."
docker compose down

# 清除构建缓存
echo "清除构建缓存..."
docker builder prune -f

# 清除孤立的构建缓存（可选，更彻底）
echo "清除孤立的构建缓存..."
docker system prune -f

# 构建并启动服务
echo "构建并启动SDAV服务..."
docker compose up --build -d

# 显示运行的服务
echo "正在运行的服务:"
docker compose ps

echo "======= 启动完成 ======="
echo "SDAV服务现在应该运行成功"
echo "用户名: admin"
echo "密码: password"
