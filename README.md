README.md
# RTFE(项目开发时名称为SDAV) - 用WebSocket增强的WebDAV文件同步神器

这个项目把WebDAV协议和WebSocket技术结合在一起，让你能在多台设备之间实时同步文件，再也不用担心文件不同步的问题啦！

## 这个项目能干啥？

- ✅ 完整支持WebDAV协议（就是标准的文件操作）
- ✅ 用WebSocket实时告诉你文件有啥变化
- ✅ 可以选择关注哪些文件/文件夹的变化
- ✅ 有心跳机制，自动清理掉线的连接
- ✅ 跨平台同步（Windows、Mac、Linux都能用）
- ✅ 安全认证，保护你的文件安全
- ✅ Docker一键部署，简单方便

## 特性对比表

| 功能/特性 | SDAV | 传统WebDAV | SMB | FTP |
|----------|------|------------|-----|-----|
| 文件操作 | ✅ | ✅ | ✅ | ✅ |
| 实时变更通知 | ✅ | ❌(需要客户端主动轮询) | ❌(需要客户端主动轮询) | ❌(需要客户端主动轮询) |
| 路径订阅功能 | ✅ | ❌ | ❌ | ❌ |
| WebSocket推送 | ✅ | ❌ | ❌ | ❌ |
| 跨平台支持 | ✅ | ✅ | 有限支持* | ✅ |
| 安全认证 | ✅ | ✅ | ✅ | ✅** |
| Docker部署 | ✅ | 有限支持 | ❌ | 需额外配置 |
| 无需额外数据库 | ✅ | 部分需要 | N/A | 部分需要 |
| 断点续传 | 计划中 | ✅ | ✅ | ✅ |
| 心跳检测机制 | ✅ | ❌ | N/A | 有限支持 |

* SMB在某些操作系统上可能需要特殊配置  
** FTP的安全性较低，容易被嗅探  

## 怎么快速开始？

### 推荐方式：用Docker（最简单）

1. 克隆或下载这个项目
2. 打开终端进入项目目录
3. 运行启动脚本：

```bash
chmod +x start.sh
./start.sh
```

如果你喜欢手动操作：

```bash
# 先停掉旧的容器
docker compose down

# 清理一下构建缓存
docker builder prune -f

# 重新构建并启动服务
docker compose up --build -d
```

服务会在 `http://localhost:3000` 上跑起来

### 手动安装（适合折腾党）

1. 先安装Node.js和npm
2. 克隆或下载项目
3. 进入项目目录，运行 `npm install` 安装依赖
4. 在 `.env` 文件里配置环境变量
5. 运行 `npm start` 启动服务器
6. 用浏览器或WebDAV客户端访问服务器

## 配置说明

在 `docker-compose.yml` 文件里可以配置各种环境变量：

- `USERNAME`: WebDAV用户名（默认是admin）
- `PASSWORD`: WebDAV密码（默认是password）
- `NODE_ENV`: 环境（默认是production）

## 测试功能

我们提供了测试脚本帮你验证WebDAV和WebSocket功能：

```bash
# 先安装依赖
pip install requests websocket-client

# 然后运行测试
python test.py
```

## 技术架构

- **WebDAV层**: 实现标准WebDAV协议，用来操作文件
- **WebSocket层**: 实时告诉你文件变了啥
- **订阅管理器**: 让你能选择关注哪些文件/文件夹
- **文件系统**: 用本地文件系统存储（不需要数据库）
- **认证**: 基础认证保护你的访问安全

## 订阅功能（重点来了！）

订阅功能让你可以选择监听特定文件或文件夹的变化。你可以订阅感兴趣的地方，只接收这些地方的变化通知。

### 客户端WebSocket命令

你可以用这些WebSocket命令和订阅系统互动：

1. **订阅路径**:
   ```json
   {
     "type": "subscribe",
     "path": "/你想监听的路径"
   }
   ```

   路径模式:
   - `/folder/**` - 监听所有文件和子文件夹（包括嵌套的）
   - `/folder/*` - 只监听当前文件夹的直接子项
   - `/file.txt` - 监听特定文件

2. **取消订阅路径**:
   ```json
   {
     "type": "unsubscribe",
     "path": "/你想取消监听的路径"
   }
   ```

3. **获取当前订阅**:
   ```json
   {
     "type": "getSubscriptions"
   }
   ```

### 服务器WebSocket事件

服务器会给订阅了的客户端发这些事件:

- `fileChange`: 文件或文件夹有变化时发送
  ```json
  {
    "type": "fileChange",
    "eventType": "created|updated|deleted|directoryCreated|directoryDeleted",
    "path": "/发生变化的文件路径",
    "timestamp": "时间戳"
  }
  ```

- `subscriptionConfirmed`: 订阅成功时发送
  ```json
  {
    "type": "subscriptionConfirmed",
    "path": "/你订阅的路径",
    "message": "订阅成功啦！"
  }
  ```

- `unsubscriptionConfirmed`: 取消订阅成功时发送
  ```json
  {
    "type": "unsubscriptionConfirmed",
    "path": "/你取消订阅的路径",
    "message": "取消订阅成功！"
  }
  ```

## 安全措施

- 所有操作都要身份验证（不用担心陌生人乱动你的文件）
- 密码通过环境变量配置（更安全）
- 支持CORS（浏览器友好）
- 用Helmet加强HTTP头安全


## 常见问题解决

如果遇到问题，按下面步骤排查：

1. 确认服务器是不是在运行，能不能访问
2. 检查用户名密码是不是对的
3. 确认文件权限够不够
4. 看看服务器日志有没有报错

如果是Docker问题：
```bash
# 查看容器日志
docker compose logs

# 重启服务
./start.sh
```

## 未来计划

- 采用私有化的文件协议，支持断点续传、压缩传输等等

## 来点想法!

根据Linux哲学，万物皆文件，所有API也可以是文件，即文件驱动API（File‑Driven API，FDA）
所以借助本项目可以轻松实现一个轻量化的API方式

### 具体实现

1. 客户端连接本项目并创建一个JSON文件（当然，YAML等等也都可以，JSON不是必须的）
2. 客户端订阅项目，如果文件有改动客户端可以及时收到通知而不需要轮询

这个思路的优点:
- 不需要复杂的API，前端开发人员也可以轻松完成全栈开发
- 对比真正的API，延迟方面丝毫不逊色
- 可以多个程序共用这一个后端API
缺点:
- 无法满足复杂的鉴权要求
- 无法满足大型API复杂的并发需求

ps:如果需要后端处理，则可以单独部署一个脚本在后端负责处理文件而不必写复杂的API

## 遇到问题了？

有问题随时提issue，我们会尽快回复你！也可以看看我们的文档，也许能找到解决方案。

## ps:
因为6月份要高考的原因,预计下一次要6月末才能更新
