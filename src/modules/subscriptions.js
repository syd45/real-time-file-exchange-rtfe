const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');

// 存储客户端订阅信息
class SubscriptionManager {
  constructor(uploadDir) {
    this.uploadDir = uploadDir;

    // 从环境变量获取要监听的特定路径，如果没有则默认监听整个上传目录
    const watchPathsEnv = process.env.WATCH_PATHS || '';
    if (watchPathsEnv) {
      // 解析环境变量中的多个路径（用逗号分隔）
      this.watchPaths = watchPathsEnv.split(',').map(p => p.trim()).filter(p => p);
      console.log(`[SubscriptionManager] Watching specific paths: ${this.watchPaths.join(', ')}`);
    } else {
      this.watchPaths = [this.uploadDir]; // 默认监听整个上传目录
      console.log(`[SubscriptionManager] Watching default upload directory: ${this.uploadDir}`);
    }

    this.subscriptions = new Map(); // 存储WebSocket客户端与其订阅路径的映射
    this.watcher = null;
    this.clientInfo = new Map(); // 存储客户端信息，包括连接时间、订阅数等
    this.performanceMetrics = {
      totalNotificationsSent: 0,
      totalFileEvents: 0,
      totalMatchesFound: 0,
      startTime: Date.now()
    };
    this.initWatcher();
  }

  // 初始化文件监视器
  initWatcher() {
    // 根据环境变量配置决定监视哪些路径
    const watchTargets = this.watchPaths.length > 0 ? this.watchPaths : [this.uploadDir];

    // 监视指定路径或默认的上传目录
    this.watcher = chokidar.watch(watchTargets, {
      persistent: true,
      ignoreInitial: true, // 忽略初始扫描事件
      ignorePermissionErrors: true,
      usePolling: false, // 禁用轮询，改用文件系统事件（更高效）
      interval: 100, // 减少轮询间隔（仅在usePolling=true时生效）
      binaryInterval: 300, // 二进制文件轮询间隔
      awaitWriteFinish: false, // 禁用等待写入完成以减少延迟
      ignored: [
        /(^|[\/\\])\../, // 忽略以.开头的文件/目录（如 .git, .DS_Store 等）
        /tmp/, /temp/, // 忽略临时目录
        /node_modules/, // 忽略node_modules
        /venv/, /virtualenv/, /env/, /.env/, // 忽略Python虚拟环境目录
        /\.log$/, /\.tmp$/, /\.cache$/ // 忽略常见的临时文件扩展名
      ]
    });

    // 监听文件变化事件
    this.watcher
      .on('add', (filePath) => this.handleFileEvent('created', filePath))
      .on('change', (filePath) => this.handleFileEvent('updated', filePath))
      .on('unlink', (filePath) => this.handleFileEvent('deleted', filePath))
      .on('addDir', (dirPath) => this.handleFileEvent('directoryCreated', dirPath))
      .on('unlinkDir', (dirPath) => this.handleFileEvent('directoryDeleted', dirPath))
      .on('error', (error) => console.error('Watcher error:', error));
  }

  // 验证订阅路径是否有效
  validateSubscriptionPath(subscriptionPath) {
    // 检查路径是否为空或无效
    if (!subscriptionPath || typeof subscriptionPath !== 'string') {
      return { valid: false, reason: 'Invalid subscription path' };
    }

    // 规范化路径
    const normalizedPath = path.normalize(subscriptionPath.replace(/\\/g, '/'));

    // 检查路径是否以 / 开头（对于相对路径）
    if (!normalizedPath.startsWith('/') && normalizedPath !== '/') {
      return { valid: false, reason: 'Subscription path must be absolute (start with /)' };
    }

    // 特殊处理根路径 "/"
    if (normalizedPath === '/') {
      return { valid: true, normalizedPath: '/' };
    }

    // 对于非根路径，检查是否试图访问上传目录之外的位置
    const resolvedPath = path.resolve(this.uploadDir, normalizedPath.substring(1)); // Remove leading slash for relative resolution
    const uploadDirResolved = path.resolve(this.uploadDir);

    if (!resolvedPath.startsWith(uploadDirResolved)) {
      return { valid: false, reason: 'Subscription path attempts to access outside upload directory' };
    }

    // 检查通配符模式是否有效
    if (normalizedPath.includes('**') && !normalizedPath.endsWith('/**')) {
      // 通配符只能出现在路径末尾
      return { valid: false, reason: 'Wildcard pattern /** can only appear at the end of the path' };
    }

    if (normalizedPath.includes('*') && !normalizedPath.endsWith('/*') && !normalizedPath.endsWith('/**')) {
      // 通配符只能出现在路径末尾作为 /* 或 /**
      return { valid: false, reason: 'Wildcard pattern can only be /* or /** at the end of the path' };
    }

    return { valid: true, normalizedPath };
  }

  // 处理文件事件
  handleFileEvent(eventType, filePath) {
    // 检查文件路径是否在我们想要监视的路径范围内
    if (!this.isPathInWatchedDirectories(filePath)) {
      // 如果不在指定的监视路径内，直接返回，不处理该事件
      return;
    }

    console.log(`[SubscriptionManager] Handling file event: ${eventType} for path: ${filePath}`);

    // 更新性能指标
    this.performanceMetrics.totalFileEvents++;

    // 将绝对路径转换为相对于上传目录的路径
    const relativePath = path.relative(this.uploadDir, filePath);
    console.log(`[SubscriptionManager] Converted to relative path: ${relativePath}`);

    // 获取文件统计信息（大小等）
    let fileSize = 0;
    try {
      const stats = fs.statSync(filePath);
      fileSize = stats.size;
    } catch (err) {
      console.log(`[SubscriptionManager] Could not get file stats for ${filePath}: ${err.message}`);
    }

    // 遍历所有订阅者，检查他们的订阅路径是否匹配
    let matchesFound = 0;
    console.log(`[SubscriptionManager] Total subscriptions to check: ${this.subscriptions.size}`);

    for (const [client, subscriptions] of this.subscriptions.entries()) {
      console.log(`[SubscriptionManager] Checking client with ${subscriptions.size} subscriptions`);
      for (const subscriptionPath of subscriptions) {
        console.log(`[SubscriptionManager] Checking subscription path: ${subscriptionPath} against file path: ${relativePath}`);
        if (this.isPathMatch(relativePath, subscriptionPath)) {
          console.log(`[SubscriptionManager] Path match found! Sending notification for ${eventType} of ${relativePath}`);

          // 向订阅者发送通知
          const notification = {
            type: 'fileChange',
            eventType,
            path: relativePath,
            timestamp: new Date().toISOString(),
            size: fileSize
          };

          // 添加MIME类型（如果可能的话）
          const ext = path.extname(filePath).toLowerCase();
          if (ext) {
            // 简单的MIME类型映射
            const mimeTypes = {
              '.txt': 'text/plain',
              '.html': 'text/html',
              '.htm': 'text/html',
              '.css': 'text/css',
              '.js': 'application/javascript',
              '.json': 'application/json',
              '.xml': 'application/xml',
              '.pdf': 'application/pdf',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.png': 'image/png',
              '.gif': 'image/gif',
              '.svg': 'image/svg+xml',
              '.mp4': 'video/mp4',
              '.avi': 'video/x-msvideo',
              '.mov': 'video/quicktime',
              '.zip': 'application/zip',
              '.rar': 'application/vnd.rar',
              '.doc': 'application/msword',
              '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              '.xls': 'application/vnd.ms-excel',
              '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            };

            const mimeType = mimeTypes[ext] || 'application/octet-stream';
            notification.mimeType = mimeType;
          }

          this.notifyClient(client, notification);
          matchesFound++;
          this.performanceMetrics.totalNotificationsSent++; // 更新通知计数

          // 不break，允许一个事件触发多个订阅（例如，多个路径都匹配）
          // break; // 找到匹配就退出内层循环
        } else {
          console.log(`[SubscriptionManager] No match for subscription path: ${subscriptionPath} and file path: ${relativePath}`);
        }
      }
    }

    console.log(`[SubscriptionManager] Matches found: ${matchesFound}, Total notifications sent: ${this.performanceMetrics.totalNotificationsSent}`);

    // 更新匹配计数
    this.performanceMetrics.totalMatchesFound += matchesFound;
  }

  // 检查文件路径是否在我们想要监视的目录范围内
  isPathInWatchedDirectories(filePath) {
    // 如果没有定义特定的监视路径，或者监视整个上传目录，则返回true
    if (!this.watchPaths || this.watchPaths.length === 0 ||
        this.watchPaths.some(watchPath => watchPath === this.uploadDir)) {
      return true;
    }

    // 检查文件路径是否在任何指定的监视路径下
    return this.watchPaths.some(watchPath => {
      const relativePath = path.relative(watchPath, filePath);
      // 如果相对路径不以".."开头，说明filePath在watchPath下面
      return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
    });
  }

  // 检查路径是否与订阅模式匹配（优化版本）
  isPathMatch(filePath, subscriptionPath) {
    // 规范化路径分隔符
    const normalizedFilePath = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const normalizedSubscriptionPath = subscriptionPath.replace(/\\/g, '/').replace(/^\.\//, '');

    // 如果订阅路径是根路径 "/"
    if (normalizedSubscriptionPath === '/' || normalizedSubscriptionPath === '') {
      return true; // 根路径匹配所有文件
    }

    // 如果订阅路径以 /** 结尾，表示递归匹配所有子路径
    if (normalizedSubscriptionPath.endsWith('/**')) {
      const basePath = normalizedSubscriptionPath.slice(0, -3); // 移除 /**

      // 处理根路径情况
      if (basePath === '' || basePath === '/') {
        return true; // / 匹配所有路径
      }

      // 去除basePath的前导斜杠进行比较
      const basePathNoLeadingSlash = basePath.replace(/^\/+/, '');

      return normalizedFilePath === basePathNoLeadingSlash ||
             normalizedFilePath.startsWith(basePathNoLeadingSlash + '/');
    }

    // 如果订阅路径以 /* 结尾，表示匹配直接子项
    if (normalizedSubscriptionPath.endsWith('/*')) {
      const parentPath = normalizedSubscriptionPath.slice(0, -2); // 移除 /*

      // 处理根路径情况
      if (parentPath === '' || parentPath === '/') {
        // / 匹配所有顶级路径 (files/dirs directly under root)
        const fileParts = normalizedFilePath.split('/');
        return fileParts.length === 1; // Only one part means it's directly under root
      }

      const parentPathNoLeadingSlash = parentPath.replace(/^\/+/, '');
      const fileParentPath = path.dirname(normalizedFilePath).replace(/\\/g, '/');

      return fileParentPath === parentPathNoLeadingSlash;
    }

    // 精确匹配 - need to adjust for how relative paths are calculated
    // filePath is relative to upload dir (e.g., "file.txt", "subdir/file.txt")
    // subscriptionPath is absolute (e.g., "/file.txt", "/subdir/**")
    const subscriptionPathWithoutLeadingSlash = normalizedSubscriptionPath.replace(/^\/+/, '');

    // 处理订阅路径为单个目录的情况（例如 "/rime" 应该匹配 "rime/file.txt" 或 "/rime/" 应该匹配 "rime/file.txt"）
    if (!subscriptionPathWithoutLeadingSlash.includes('*')) {
      // 如果订阅路径以目录名结尾（不含文件名），检查文件路径是否在该目录下
      if (subscriptionPathWithoutLeadingSlash.endsWith('/')) {
        const directoryName = subscriptionPathWithoutLeadingSlash.replace(/\/$/, ''); // 移除末尾的斜杠
        // 检查文件路径是否在订阅目录下
        if (normalizedFilePath === directoryName ||
            normalizedFilePath.startsWith(directoryName + '/')) {
          return true;
        }
      } else {
        // 如果订阅路径不以斜杠结尾，检查是否精确匹配或作为目录前缀
        if (normalizedFilePath === subscriptionPathWithoutLeadingSlash) {
          return true; // 精确匹配
        }

        // 检查文件路径是否在订阅目录下（例如订阅 "rime" 匹配 "rime/filename.txt"）
        if (normalizedFilePath.startsWith(subscriptionPathWithoutLeadingSlash + '/')) {
          return true;
        }
      }
    }

    return normalizedFilePath === subscriptionPathWithoutLeadingSlash;
  }

  // 向客户端发送通知
  notifyClient(client, message) {
    if (client && client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(JSON.stringify(message));
        console.log(`[SubscriptionManager] Sent message to client: ${JSON.stringify(message)}`);
      } catch (error) {
        console.error('Error sending notification to client:', error.message);
        // 如果发送失败，移除该客户端
        this.unsubscribeAll(client);
      }
    } else {
      console.log(`[SubscriptionManager] Cannot send message to client - client not connected or invalid: ${client ? client.readyState : 'null'}`);
    }
  }

  // 客户端订阅特定路径
  subscribe(client, subscriptionPath) {
    // 验证订阅路径
    const validation = this.validateSubscriptionPath(subscriptionPath);
    if (!validation.valid) {
      // 发送错误消息
      this.notifyClient(client, {
        type: 'subscriptionError',
        path: subscriptionPath,
        message: `Subscription failed: ${validation.reason}`
      });
      return false;
    }

    // 使用规范化后的路径
    const normalizedPath = validation.normalizedPath;

    if (!this.subscriptions.has(client)) {
      this.subscriptions.set(client, new Set());
      // 记录客户端连接信息
      this.clientInfo.set(client, {
        connectedAt: new Date(),
        subscriptionCount: 0
      });
    }

    const clientSubscriptions = this.subscriptions.get(client);

    // 如果已经订阅了这个路径，不重复订阅
    if (clientSubscriptions.has(normalizedPath)) {
      this.notifyClient(client, {
        type: 'subscriptionInfo',
        path: normalizedPath,
        message: `Already subscribed to ${normalizedPath}`
      });
      return true;
    }

    clientSubscriptions.add(normalizedPath);

    // 更新客户端信息
    const clientInfo = this.clientInfo.get(client);
    if (clientInfo) {
      clientInfo.subscriptionCount = clientSubscriptions.size;
    }

    // 发送确认消息
    this.notifyClient(client, {
      type: 'subscriptionConfirmed',
      path: normalizedPath,
      message: `Successfully subscribed to ${normalizedPath}`
    });

    return true;
  }

  // 客户端取消订阅特定路径
  unsubscribe(client, subscriptionPath) {
    if (this.subscriptions.has(client)) {
      const clientSubscriptions = this.subscriptions.get(client);
      const success = clientSubscriptions.delete(subscriptionPath);

      // 更新客户端信息
      const clientInfo = this.clientInfo.get(client);
      if (clientInfo) {
        clientInfo.subscriptionCount = clientSubscriptions.size;
      }

      // 如果没有订阅了，删除整个客户端条目
      if (clientSubscriptions.size === 0) {
        this.subscriptions.delete(client);
        this.clientInfo.delete(client);
      }

      if (success) {
        // 发送确认消息
        this.notifyClient(client, {
          type: 'unsubscriptionConfirmed',
          path: subscriptionPath,
          message: `Successfully unsubscribed from ${subscriptionPath}`
        });
      } else {
        // 发送错误消息
        this.notifyClient(client, {
          type: 'unsubscriptionError',
          path: subscriptionPath,
          message: `Not subscribed to ${subscriptionPath}`
        });
      }

      return success;
    }

    return false;
  }

  // 客户端取消所有订阅
  unsubscribeAll(client) {
    if (this.subscriptions.has(client)) {
      this.subscriptions.delete(client);
      this.clientInfo.delete(client);
    }
  }

  // 获取客户端的所有订阅
  getClientSubscriptions(client) {
    if (this.subscriptions.has(client)) {
      return Array.from(this.subscriptions.get(client));
    }
    return [];
  }

  // 获取客户端信息
  getClientInfo(client) {
    return this.clientInfo.get(client) || null;
  }

  // 获取性能指标
  getPerformanceMetrics() {
    return {
      ...this.performanceMetrics,
      uptime: Date.now() - this.performanceMetrics.startTime,
      activeSubscriptions: this.getActiveSubscriptionCount(),
      activeClients: this.getActiveClientCount()
    };
  }

  // 获取活跃订阅数量
  getActiveSubscriptionCount() {
    let count = 0;
    for (const subscriptions of this.subscriptions.values()) {
      count += subscriptions.size;
    }
    return count;
  }

  // 获取活跃客户端数量
  getActiveClientCount() {
    return this.subscriptions.size;
  }

  // 关闭监视器
  close() {
    if (this.watcher) {
      this.watcher.close();
    }
  }
}

module.exports = SubscriptionManager;
