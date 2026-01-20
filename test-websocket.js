const WebSocket = require(\"ws\");  
  
// 创建WebSocket连接  
const ws = new WebSocket(\"ws://localhost:3000\");  
  
ws.on(\"open\", () = 
  console.log(\"Connected to WebSocket server\");  
  
  // 发送订阅消息  
  ws.send(JSON.stringify({  
    type: \"subscribe\",  
    path: \"/\"  
  }));  
});  
  
ws.on(\"message\", (data) = 
  console.log(\"Received update:\", data.toString());  
});  
  
ws.on(\"close\", () = 
  console.log(\"Disconnected from WebSocket server\");  
