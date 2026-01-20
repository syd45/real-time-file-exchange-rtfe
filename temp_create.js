const chokidar = require(\'chokidar\');  
const path = require(\'path\');  
  
// 存储客户端订阅信息  
class SubscriptionManager {  
  constructor(uploadDir) {  
    this.uploadDir = uploadDir;  
    this.subscriptions = new Map(); // 存储WebSocket客户端与其订阅路径的映射  
    this.watcher = null;  
    this.initWatcher();  
  } 
