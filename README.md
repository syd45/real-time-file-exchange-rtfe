# SDAV - WebDAV with WebSocket Real-time Notifications

This project combines WebDAV protocol with WebSocket technology to provide real-time file synchronization notifications across multiple devices.

## 功能特性

- 完整的WebDAV协议支持
- 通过WebSocket实现实时文件变更通知
- 可自定义的文件/文件夹变更订阅
- WebSocket心跳机制，自动检测和清理断开的连接
- 跨平台文件同步
- 安全的身份验证和授权
- HTTPS加密支持
- Docker部署

## 快速开始

### 使用Docker（推荐）

1. 克隆或下载此项目
2. 进入项目目录
3. 运行启动脚本来构建并启动服务：

```bash
chmod +x start.sh
./start.sh
```

或者手动执行：

```bash
# 停止现有容器
docker compose down

# 清理构建缓存
docker builder prune -f

# 构建并启动服务
docker compose up --build -d
```

服务将在 `http://localhost:3000` 上可用

### 手动安装

1. 安装Node.js和npm
2. 克隆或下载此项目
3. 进入项目目录并运行 `npm install`
4. 在 `.env` 文件中配置环境变量
5. 运行 `npm start` 来启动服务器
6. 通过浏览器或WebDAV客户端访问服务器

## 配置

可以在 `docker-compose.yml` 文件中使用环境变量配置服务：

- `USERNAME`: WebDAV用户名（默认：admin）
- `PASSWORD`: WebDAV密码（默认：password）
- `NODE_ENV`: 环境（默认：production）

## 测试

提供了测试脚本来验证WebDAV和WebSocket功能：

```bash
# 安装依赖
pip install requests websocket-client

# 运行测试
python test.py
```

## 架构

- **WebDAV层**: 实现标准WebDAV协议用于文件操作
- **WebSocket层**: 提供文件变更的实时通知
- **订阅管理器**: 允许客户端订阅特定文件/文件夹的变更
- **文件系统**: 使用本地文件系统进行直接文件存储（无数据库）
- **认证**: 基础认证确保安全访问

## 订阅功能

订阅功能允许客户端监听特定文件或文件夹的变化。客户端可以动态订阅感兴趣的路径，并且只会收到这些路径变化的通知。

### 客户端WebSocket命令

客户端可以通过以下WebSocket命令与订阅系统交互：

1. **订阅路径**:
   ```json
   {
     "type": "subscribe",
     "path": "/要监听的路径"
   }
   ```

   路径模式:
   - `/folder/**` - 递归监听所有文件和子文件夹
   - `/folder/*` - 只监听文件夹的直接子项
   - `/file.txt` - 监听特定文件

2. **取消订阅路径**:
   ```json
   {
     "type": "unsubscribe",
     "path": "/要取消监听的路径"
   }
   ```

3. **获取当前订阅**:
   ```json
   {
     "type": "getSubscriptions"
   }
   ```

### 服务器WebSocket事件

服务器向已订阅的客户端发送以下事件:

- `fileChange`: 当文件或文件夹发生变化时发送
  ```json
  {
    "type": "fileChange",
    "eventType": "created|updated|deleted|directoryCreated|directoryDeleted",
    "path": "/发生变化项目的相对路径",
    "timestamp": "ISO8601时间戳"
  }
  ```

- `subscriptionConfirmed`: 订阅成功时发送
  ```json
  {
    "type": "subscriptionConfirmed",
    "path": "/订阅的路径",
    "message": "成功消息"
  }
  ```

- `unsubscriptionConfirmed`: 取消订阅成功时发送
  ```json
  {
    "type": "unsubscriptionConfirmed",
    "path": "/取消订阅的路径",
    "message": "成功消息"
  }
  ```

## 安全性

- 所有操作都需要基本身份验证
- 凭据通过环境变量配置
- 为Web客户端启用CORS
- 使用Helmet确保HTTP头安全

## 修复内容 (0.1.13版本)

此版本修复了rclone客户端的以下错误：

1. **"unexpected EOF" 错误** - 通过优化文件传输缓冲区大小和超时设置解决
2. **"404 Not Found" 错误** - 通过改进文件系统操作和事件处理解决

### 主要变更

- 增加了文件传输的缓冲区大小（16MB-64MB动态调整）
- 延长了请求超时时间至10分钟
- 优化了流处理逻辑，增加了更好的错误处理
- 提高了文件句柄限制至131072
- 为rclone优化了上传和下载的highWaterMark设置
- 添加了额外的延迟以确保文件系统完全写入

### 系统优化

某些系统级优化需要在宿主机上设置，详情请参见 `SYSTEM_OPTIMIZATION.md` 文档。

### rclone配置

使用提供的 `rclone_test_config.conf` 文件来优化rclone性能。

对于特别大的文件或不稳定的网络连接，可以使用以下高级配置：

```bash
# 针对大文件传输的rclone命令
rclone copy bigfile.zip remote:path/ --config=rclone_test_config.conf --transfers 1 --checkers 1 --low-level-retries 10 --retries 5 --timeout 10m --contimeout 2m

# 或者在rclone.conf中添加以下参数
[advanced_remote]
type = webdav
url = http://localhost:1622
vendor = other
user = YOUR_USERNAME
pass = YOUR_PASSWORD
retries = 10
retries-sleep = 1s
low-level-retries = 10
max-backlog = 1
checkers = 1
transfers = 1
timeout = 10m
contimeout = 2m
expectContinue = true
```

### 针对大文件下载的优化

对于大文件下载，特别是遇到EOF错误时，建议使用以下参数：

```bash
# 针对大文件下载的优化命令
rclone copy remote:path/bigfile.zip ./ --config=rclone_test_config.conf \
  --transfers 1 \
  --checkers 1 \
  --low-level-retries 15 \
  --retries 15 \
  --timeout 20m \
  --contimeout 5m \
  --buffer-size 32M \
  --max-backlog 1 \
  --vfs-cache-mode writes \
  --vfs-cache-max-size 1G \
  --vfs-cache-max-age 1m
```

## 故障排除

如果遇到问题：

1. 检查服务器是否正在运行且可访问
2. 验证凭据是否正确
3. 确保适当的文件权限
4. 检查服务器日志中的错误

对于Docker问题：
```bash
# 查看容器日志
docker compose logs

# 重启服务
./start.sh

