# WebSocket测试脚本使用指南

这是一个用于测试SDAV项目WebSocket功能和WebDAV集成的Python脚本。

## 准备工作

确保你已经安装了所需的依赖包：

```bash
pip install requests websocket-client
```

## 基本使用

直接运行脚本进行测试：

```bash
python test.py
```

## 配置选项

可以通过命令行参数或环境变量进行配置：

### 命令行参数

- `--url` 或 `-u`: 服务器地址（默认: your_server_address）
- `--username` 或 `-n`: 用户名（默认: your_username）
- `--password` 或 `-p`: 密码（默认: your_password）
- `--port`: 服务器端口（默认: 3000）
- `--test-dir` 或 `-d`: 测试目录（默认: /test/）
- `--test-timeout`: 测试超时时间（默认: 30秒）
- `--debug`: 启用调试模式
- `--ws-path`: WebSocket路径（默认: /ws）

### 环境变量

- `TEST_URL` 或 `URL`: 服务器地址
- `TEST_USERNAME` 或 `USERNAME`: 用户名
- `TEST_PASSWORD` 或 `PASSWORD`: 密码
- `TEST_PORT` 或 `PORT`: 服务器端口
- `TEST_DIR`: 测试目录
- `TEST_TIMEOUT`: 测试超时时间
- `DEBUG`: 调试模式开关
- `WS_PATH`: WebSocket路径

## 示例

使用环境变量配置：

```bash
export TEST_URL=localhost
export TEST_USERNAME=admin
export TEST_PASSWORD=password
export TEST_PORT=3000
python test.py
```

使用命令行参数：

```bash
python test.py --url localhost --username admin --password password --port 3000
```

## 测试内容

脚本会自动执行以下测试：

1. **WebSocket连接测试**：连接、认证和订阅功能
2. **WebDAV方法测试**：包括创建、读取、更新、删除文件
3. **集成测试**：WebDAV操作触发WebSocket通知的集成测试

## 输出结果

脚本会显示各项测试的结果和总体成功率，帮助你评估SDAV服务的功能完整性。