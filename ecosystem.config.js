module.exports = {
  apps: [{
    name: 'sdav',
    script: './src/server.js',
    // 在Docker容器中，使用单个实例的fork模式以避免文件监视重复问题和IPC复杂性
    instances: 1,  // 固定为1个实例
    exec_mode: 'fork',  // 使用fork模式而非cluster
    max_memory_restart: '4G',  // 增加内存限制以支持大文件处理
    node_args: '--max-old-space-size=4096 --expose-gc',  // 增加内存限制并启用垃圾回收
    env: {
      NODE_ENV: 'production',
      // 从系统环境变量继承所有配置
      ...process.env
    }
  }]
};
