const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs-extra");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
require("dotenv").config();
const { basicAuthMiddleware } = require("./config/auth");
const SubscriptionManager = require('./modules/subscriptions');

// 配置
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ENV_UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const TIMEOUT = parseInt(process.env.TIMEOUT) || 1800000; // 默认30分钟超时，适应大文件传输，但仍比原来更合理
const KEEP_ALIVE_TIMEOUT = parseInt(process.env.KEEP_ALIVE_TIMEOUT) || 120; // 默认120秒，适应大文件传输
const CONNECTION_IDLE_TIMEOUT = parseInt(process.env.CONNECTION_IDLE_TIMEOUT) || 300; // 默认300秒连接空闲超时
const HTTP_MAX_RETRIES = parseInt(process.env.HTTP_MAX_RETRIES) || 5; // HTTP最大重试次数
const HTTP_RETRY_DELAY_MS = parseInt(process.env.HTTP_RETRY_DELAY_MS) || 2000; // HTTP重试延迟
const HTTP_IDLE_CONN_TIMEOUT = parseInt(process.env.HTTP_IDLE_CONN_TIMEOUT) || 120; // 空闲连接超时
const HTTP_MAX_IDLE_CONNS = parseInt(process.env.HTTP_MAX_IDLE_CONNS) || 100; // 最大空闲连接数
const HTTP_MAX_IDLE_CONNS_PER_HOST = parseInt(process.env.HTTP_MAX_IDLE_CONNS_PER_HOST) || 10; // 每个主机的最大空闲连接数
const FS_SYNC_ON_CLOSE = process.env.FS_SYNC_ON_CLOSE === 'true'; // 关闭时同步文件
const FS_READ_AHEAD = process.env.FS_READ_AHEAD || '128M'; // 设置读取预加载
const FS_BUFFER_MULTIPLE = parseInt(process.env.FS_BUFFER_MULTIPLE) || 4; // 缓冲区倍数

// 确保上传目录存在
const absoluteUploadDir = path.resolve(ENV_UPLOAD_DIR);
fs.ensureDirSync(absoluteUploadDir);

// 传递UPLOAD_DIR给控制器
const webdavController = require("./controllers/webdavController");
const { integrateWithExpress, setUploadDir, setSubscriptionManager } = webdavController;
// 设置UPLOAD_DIR
setUploadDir(absoluteUploadDir);

const app = express();
const server = http.createServer(app);
// 创建WebSocket服务器并将其附加到同一个HTTP服务器
const wss = new WebSocket.Server({ server });

// 中间件
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 使用身份验证中间件 - 但需要特殊处理WebDAV请求
app.use((req, res, next) => {
  // 检查是否是WebDAV请求
  const webdavMethods = ['PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK', 'PUT', 'DELETE', 'GET', 'HEAD'];
  if (webdavMethods.includes(req.method.toUpperCase())) {
    // 对WebDAV请求应用基本认证
    basicAuthMiddleware(req, res, next);
  } else {
    // 对非WebDAV请求也应用认证
    basicAuthMiddleware(req, res, next);
  }
});

// 初始化WebDAV服务器
integrateWithExpress(app);

// 最后的兜底路由，处理其他未处理的WebDAV请求
app.use((req, res) => {
  // 检查是否是WebDAV请求方法
  const webdavMethods = ['PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK', 'PUT', 'DELETE'];
  if (webdavMethods.includes(req.method.toUpperCase())) {
    // 对于WebDAV请求，返回WebDAV兼容的404响应
    if (req.method === 'PROPFIND') {
      const xmlResponse = '<?xml version="1.0" encoding="utf-8"?>' +
        '<D:multistatus xmlns:D="DAV:" xmlns:ns1="http://apache.org/dav/props/" xmlns:ns0="DAV:">' +
        '<D:response>' +
        `<D:href>${req.url}</D:href>` +
        '<D:propstat><D:prop><D:resourcetype/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>' +
        '</D:response>' +
        '</D:multistatus>';
      res.status(207); // WebDAV标准要求PROPFIND返回207
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.send(xmlResponse);
    } else {
      res.status(404).send('Not Found');
    }
  } else {
    // 对于非WebDAV请求，返回普通404
    res.status(404).send('Not Found');
  }
});

// 由于我们使用单个实例的fork模式，直接初始化完整的订阅管理器
subscriptionManager = new SubscriptionManager(absoluteUploadDir);
console.log(`[${new Date().toISOString()}] Subscription manager initialized in process ${process.pid}`);

// 设置订阅管理器到WebDAV控制器
setSubscriptionManager(subscriptionManager);

// 增强WebSocket日志记录
wss.on("connection", (ws, req) => {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // 为每个连接维护认证状态
  let isAuthenticated = false;

  // 检查请求头中的认证信息（可选，仍可接受连接时认证）
  const authHeader = req.headers.authorization;
  if (authHeader && isValidAuth(authHeader)) {
    isAuthenticated = true;
    console.log(`[${new Date().toISOString()}] New WebSocket client [${clientId}] connected with authentication from ${req.socket.remoteAddress}`);
  } else {
    console.log(`[${new Date().toISOString()}] New WebSocket client [${clientId}] connected without authentication from ${req.socket.remoteAddress}`);
    // 发送需要认证的消息
    ws.send(JSON.stringify({
      type: "auth_required",
      message: "Authentication required. Please authenticate using 'authenticate' message type."
    }));
  }

  // 根据认证状态决定是否发送欢迎消息
  if (isAuthenticated) {
    // 如果已经通过请求头认证，直接发送欢迎消息
    ws.send(JSON.stringify({
      type: "connected",
      message: "Successfully connected to SDAV WebSocket server"
    }));
  }
  // 注意：如果没有通过请求头认证，我们已经在上面发送了auth_required消息，
  // 不再发送connected消息，避免混淆

  // 标记是否已经发送过认证成功的消息，防止重复发送
  let hasSentAuthSuccess = false;

  // WebSocket心跳机制
  ws.isAlive = true;

  // 设置定时器，定期发送ping消息
  const heartbeatInterval = setInterval(() => {
    if (ws.isAlive === false) {
      console.log(`[${new Date().toISOString()}] Client [${clientId}] heartbeat timeout, terminating connection`);
      ws.terminate();
      subscriptionManager.unsubscribeAll(ws);
      return;
    }

    ws.isAlive = false;
    try {
      ws.ping();
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Error sending ping to client [${clientId}]:`, e.message);
      ws.terminate();
      subscriptionManager.unsubscribeAll(ws);
    }
  }, 30000); // 每30秒发送一次ping

  // 监听pong消息，重置alive标志
  ws.on('pong', () => {
    ws.isAlive = true;
    console.log(`[${new Date().toISOString()}] Received pong from client [${clientId}], connection alive`);
  });

  ws.on("message", (message) => {
    console.log(`[${new Date().toISOString()}] Received message from client [${clientId}]: ${message.toString()}`);

    // 解析消息并响应
    try {
      const parsedMessage = JSON.parse(message);

      // 处理认证消息
      if (parsedMessage.type === "authenticate") {
        const { username, password } = parsedMessage;
        if (username && password) {
          // 创建基本认证头部字符串并验证
          const credentials = Buffer.from(`${username}:${password}`).toString('base64');
          const authString = `Basic ${credentials}`;
          if (isValidAuth(authString)) {
            isAuthenticated = true;
            ws.send(JSON.stringify({
              type: "auth_success",
              message: "Authentication successful"
            }));
            hasSentAuthSuccess = true;
            console.log(`[${new Date().toISOString()}] Client [${clientId}] authenticated successfully`);

            // 认证成功后发送欢迎消息（仅在之前未发送的情况下）
            if (!authHeader || !isValidAuth(authHeader)) {
              ws.send(JSON.stringify({
                type: "connected",
                message: "Successfully connected to SDAV WebSocket server"
              }));
            }
          } else {
            ws.send(JSON.stringify({
              type: "auth_failed",
              message: "Authentication failed"
            }));
            console.log(`[${new Date().toISOString()}] Client [${clientId}] authentication failed`);
          }
        } else {
          ws.send(JSON.stringify({
            type: "auth_error",
            message: "Username and password required for authentication"
          }));
        }
      } else if (!isAuthenticated) {
        // 如果客户端未认证且发送的不是认证相关消息，则拒绝
        ws.send(JSON.stringify({
          type: "error",
          message: "Authentication required. Please authenticate first."
        }));
        return;
      } else if (parsedMessage.type === "subscribe") {
        // 客户端订阅特定路径的更新
        const subscriptionPath = parsedMessage.path || "/";
        const success = subscriptionManager.subscribe(ws, subscriptionPath);
        if (success) {
          console.log(`[${new Date().toISOString()}] Client [${clientId}] subscribed to: ${subscriptionPath}`);
        } else {
          // 订阅失败时发送错误消息
          ws.send(JSON.stringify({
            type: "subscriptionError",
            message: "Failed to subscribe to path: " + subscriptionPath
          }));
        }
      } else if (parsedMessage.type === "unsubscribe") {
        // 客户端取消订阅特定路径
        const subscriptionPath = parsedMessage.path;
        if (subscriptionPath) {
          const success = subscriptionManager.unsubscribe(ws, subscriptionPath);
          if (success) {
            console.log(`[${new Date().toISOString()}] Client [${clientId}] unsubscribed from: ${subscriptionPath}`);
          } else {
            // 取消订阅失败时发送错误消息
            ws.send(JSON.stringify({
              type: "unsubscriptionError",
              message: "Failed to unsubscribe from path: " + subscriptionPath
            }));
          }
        }
      } else if (parsedMessage.type === "getSubscriptions") {
        // 客户端获取其所有订阅
        const clientSubscriptions = subscriptionManager.getClientSubscriptions(ws);
        console.log(`[${new Date().toISOString()}] Client [${clientId}] requested subscriptions list (${clientSubscriptions.length} subscriptions)`);
        ws.send(JSON.stringify({
          type: "subscriptionsList",
          subscriptions: clientSubscriptions
        }));
      } else if (parsedMessage.type === "getMetrics") {
        // 客户端请求性能指标
        const metrics = subscriptionManager.getPerformanceMetrics();
        console.log(`[${new Date().toISOString()}] Client [${clientId}] requested performance metrics`);
        ws.send(JSON.stringify({
          type: "metrics",
          metrics: metrics
        }));
      } else if (parsedMessage.type === "getClientInfo") {
        // 客户端请求自身信息
        const clientInfo = subscriptionManager.getClientInfo(ws);
        console.log(`[${new Date().toISOString()}] Client [${clientId}] requested client info`);
        ws.send(JSON.stringify({
          type: "clientInfo",
          clientInfo: clientInfo
        }));
      }
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Error parsing WebSocket message from client [${clientId}]:`, e.message);
      // 发送格式错误消息
      ws.send(JSON.stringify({
        type: "error",
        message: "Invalid message format. Please send a valid JSON message."
      }));
    }
  });

  ws.on("close", () => {
    console.log(`[${new Date().toISOString()}] WebSocket client [${clientId}] disconnected`);
    clearInterval(heartbeatInterval); // 清除心跳定时器
    subscriptionManager.unsubscribeAll(ws);
  });

  // 处理WebSocket错误
  ws.on("error", (error) => {
    // 忽略连接重置错误，这些是正常的网络状况
    if (error.code === 'ECONNRESET' || error.code === 'EPIPE') {
      console.log(`[${new Date().toISOString()}] Client [${clientId}] connection reset:`, error.message);
    } else {
      console.error(`[${new Date().toISOString()}] WebSocket error for client [${clientId}]:`, error.message);
    }
    clearInterval(heartbeatInterval); // 清除心跳定时器
    subscriptionManager.unsubscribeAll(ws);
  });
});

// 验证认证头的辅助函数
function isValidAuth(authHeader) {
  const USERNAME = process.env.USERNAME || "admin";
  const PASSWORD = process.env.PASSWORD || "password";

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return false;
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  return username === USERNAME && password === PASSWORD;
}

// 将subscriptionManager暴露到全局，以便控制器可以访问
global.subscriptionManager = subscriptionManager;

// 设置服务器超时
server.timeout = TIMEOUT; // 请求超时
server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT * 1000; // Keep-alive超时
server.headersTimeout = (KEEP_ALIVE_TIMEOUT + 5) * 1000; // Headers超时应该比keep-alive超时稍长
server.requestTimeout = TIMEOUT; // 请求处理超时
server.connectionTimeout = TIMEOUT; // 连接超时

// 为rclone优化连接设置
server.maxHeadersCount = 200; // 增加最大头部数量以支持rclone的复杂请求

// 针对大文件下载优化TCP设置
server.on('connection', (socket) => {
  // 启用TCP_NODELAY以减少延迟
  socket.setNoDelay(true);

  // 设置socket超时时间
  socket.setTimeout(TIMEOUT);

  // 设置socket的keep-alive
  socket.setKeepAlive(true, 60000); // 60秒后开始发送keep-alive探测

  // 监听socket错误
  socket.on('error', (err) => {
    // 忽略连接重置错误，这些是正常的网络状况
    if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
      console.error('Socket error:', err);
    }
  });
});

// 应用HTTP连接优化设置
// 注意：Express本身不直接支持这些选项，但我们可以通过底层HTTP服务器设置它们
// 这些设置主要影响Node.js的HTTP客户端行为，对于服务器端接收连接也有帮助

// 启动服务器
server.listen({ port: PORT, host: HOST }, () => {
  console.log(`[${new Date().toISOString()}] SDAV server running at http://${HOST}:${PORT}/`);
  console.log(`[${new Date().toISOString()}] Upload directory: ${ENV_UPLOAD_DIR}`);
  console.log(`[${new Date().toISOString()}] Server timeout settings - timeout: ${TIMEOUT}ms, keepAliveTimeout: ${server.keepAliveTimeout}ms`);

  // 定期输出性能指标
  setInterval(() => {
    const metrics = subscriptionManager.getPerformanceMetrics();
    console.log(`[${new Date().toISOString()}] Performance Metrics - Events: ${metrics.totalFileEvents}, Notifications: ${metrics.totalNotificationsSent}, Matches: ${metrics.totalMatchesFound}, Active Clients: ${metrics.activeClients}, Active Subscriptions: ${metrics.activeSubscriptions}`);
  }, 30000); // 每30秒输出一次
});

module.exports = { app };