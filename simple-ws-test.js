const WebSocket = require('ws'); 
  
console.log('Testing WebSocket connection to SDAV server...');  
  
// Connect to WebSocket server  
const ws = new WebSocket('ws://localhost:3000'); 
  
ws.on('open', () => {
  console.log('Connected to WebSocket server');
  // Send authentication
  ws.send(JSON.stringify({
    type: 'authenticate',
    username: 'admin',
    password: 'password'
  }));
}); 
  
ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('Received message from server:', message);
});

ws.on('close', () => {
  console.log('WebSocket connection closed');
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
}); 
