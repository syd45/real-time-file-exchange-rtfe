# SDav 客户端开发对接指南 
  
本文档专为希望与 SDav 服务器集成的客户端开发者提供详细的技术对接信息。  
  
## 服务地址  
  
- HTTP/WebDAV 接口范例: "http://localhost:3000" (根据实际部署调整)  
- WebSocket 接口范例: "ws://localhost:3000/ws" (根据实际部署调整)  
  
## 认证方式  
  
所有请求都需要基本认证 (Basic Authentication):
- 用户名: "admin" (可通过环境变量/ui配置)
- 密码: "password" (可通过环境变量/ui配置)
  
## WebDAV 接口  
  
SDav 支持完整的 WebDAV 协议，包括：  
  
### 标准 HTTP 方法  
- "GET" - 获取文件内容  
- "PUT" - 上传/更新文件  
- "DELETE" - 删除文件或目录  
- "MKCOL" - 创建目录  
- "PROPFIND" - 获取资源属性  
- "COPY" - 复制资源  
- "MOVE" - 移动资源 
  
### 请求示例  
  
#### 获取文件  
```
GET /path/to/file.txt  
Authorization: Basic YWRtaW46cGFzc3dvcmQxMjM=  
```
  
#### 上传文件  
```
PUT /path/to/newfile.txt  
Authorization: Basic YWRtaW46cGFzc3dvcmQxMjM=  
Content-Type: application/octet-stream  
```
  
[文件内容]  
  
#### 创建目录  
```
MKCOL /new/directory/  
Authorization: Basic YWRtaW46cGFzc3dvcmQxMjM= 
``` 
  
## WebSocket 实时通知接口  
  
SDav 提供 WebSocket 接口以实现文件变更的实时通知。  
  
### 连接建立  
  
连接到 WebSocket 端点：  
`ws://localhost:3000/ws  `
  
连接后，服务器会发送确认消息：  
`{"type": "connectionEstablished", "message": "WebSocket connection established"} `
  
  
### 客户端命令  
  
客户端可以通过 WebSocket 发送以下命令：  
  
#### 1. 订阅路径  
监听特定路径的文件变更：  
`{"type": "subscribe", "path": "/path/to/watch"}  `
  
路径模式支持：  
- "/folder/**" - 递归监听所有文件和子文件夹  
- "/folder/*" - 只监听文件夹的直接子项  
- "/file.txt" - 监听特定文件  
  
#### 2. 取消订阅路径  
停止监听特定路径：  
`{"type": "unsubscribe", "path": "/path/to/unwatch"}  `
  
#### 3. 获取当前订阅列表  
获取当前所有的订阅路径：  
`{"type": "getSubscriptions"} `
  
  
### 服务器事件  
  
服务器会向已订阅的客户端推送以下事件：  
  
#### 1. 文件变更事件  
当订阅路径下的文件或文件夹发生变更时：  
```
{"type": "fileChange", "eventType": "created|updated|deleted|directoryCreated|directoryDeleted", "path": "/relative/path/to/changed/item", "timestamp": "2026-01-16T08:30:00.000Z", "size": 1024, "mimeType": "text/plain"}  
```

#### 2. 订阅确认事件  
订阅成功时发送：  
```
{"type": "subscriptionConfirmed", "path": "/path/to/watch", "message": "Successfully subscribed to path"}  
```

#### 3. 取消订阅确认事件  
取消订阅成功时发送： 
``` 
{"type": "unsubscriptionConfirmed", "path": "/path/to/unwatch", "message": "Successfully unsubscribed from path"}  
```

#### 4. 订阅列表响应  
响应 getSubscriptions 命令：  
```
{"type": "subscriptionsList", "subscriptions": ["/path/to/watch1", "/path/to/watch2/**"]} 
```
  
## 错误处理  
  
### HTTP 错误码  
- 401 Unauthorized - 认证失败  
- 403 Forbidden - 权限不足  
- 404 Not Found - 资源不存在  
- 409 Conflict - 操作冲突  
- 500 Internal Server Error - 服务器内部错误  
  
### WebSocket 错误事件 
``` 
{"type": "error", "message": "错误描述", "code": "错误代码"}  
```

## 客户端实现示例  
  
### JavaScript 客户端示例  

```
// 连接到 WebSocket  
var ws = new WebSocket('ws://localhost:3000/ws');  
  
ws.onopen = function() {  
  console.log('Connected to SDav WebSocket');  
  
  // 订阅路径  
  ws.send(JSON.stringify({  
    type: 'subscribe',  
    path: '/documents/**'  
  }));  
}; 
  
ws.onmessage = function(event) {  
  var data = JSON.parse(event.data);  
  
  switch(data.type) {  
    case 'fileChange':  
      console.log('File ' + data.eventType + ': ' + data.path);  
      // 处理文件变更  
      break;  
  
    case 'subscriptionConfirmed':  
      console.log('Subscribed to: ' + data.path);  
      break;  
  
    case 'error':  
      console.error('Error: ' + data.message);  
      break;  
  }  
};  
  
ws.onerror = function(error) {  
  console.error('WebSocket error:', error);  
}; 
```
  
## 最佳实践  
  
1. **重连机制**: 实现自动重连逻辑以应对网络中断  
2. **认证缓存**: 缓存认证凭据避免重复请求  
3. **错误处理**: 实现完善的错误处理和用户提示  
4. **订阅管理**: 合理管理订阅路径，避免不必要的通知  
5. **性能优化**: 对于大量文件变更，考虑批量处理  
  
## 调试工具  
  
- 服务器日志: 通过 docker-compose logs -f 查看  
- WebSocket 调试: 使用浏览器开发者工具或专用 WebSocket 客户端  
- WebDAV 测试: 可使用标准 WebDAV 客户端进行功能验证 
