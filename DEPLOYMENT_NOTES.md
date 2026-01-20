# 部署说明

## 修复文件监视器限制问题

### 问题描述
之前的日志显示了以下错误：
```
Watcher error: Error: ENOSPC: System limit for number of file watchers reached
```

这是由于系统对文件监视器数量的限制导致的，特别是在监视包含大量文件的目录（如Python虚拟环境）时。

### 已实施的修复措施

1. **更新了 docker-compose.yml 文件**：
   - 移除了可能导致权限问题的 `sysctls` 参数
   - 优化了 `WATCH_PATHS` 环境变量，缩小监视范围

2. **更新了源代码**：
   - 在 `src/modules/subscriptions.js` 中添加了对Python虚拟环境目录的忽略规则
   - 添加了对 `venv`, `virtualenv`, `env`, `.env` 等目录的忽略

3. **优化了集群配置**：
   - 修改了 `ecosystem.config.js`，使用单个实例的fork模式
   - 避免了多进程带来的复杂性和端口冲突问题

4. **服务器代码优化**：
   - 修改了 `src/server.js`，简化为单实例模式
   - 避免了复杂的进程间通信（IPC）需求

5. **控制器代码优化**：
   - 修改了 `src/controllers/webdavController.js`，使用全局引用
   - 确保WebDAV操作可以正确触发WebSocket通知

6. **修复路径匹配逻辑**：
   - 修复了 `src/modules/subscriptions.js` 中的 `isPathMatch` 函数
   - 确保根路径 "/" 订阅能够正确匹配所有文件变更事件

7. **配置参数说明**：
   - `WATCH_PATHS=/app/uploads/scal,/app/uploads/rime,/app/uploads`：监视必要的目录，包括根目录以确保所有文件变更被捕捉

### 部署步骤

在Ubuntu服务器上执行以下步骤：

1. 将更新后的文件复制到服务器：
   - `docker-compose.yml`
   - `src/modules/subscriptions.js`
   - `src/server.js`
   - `ecosystem.config.js`

2. **重要：在Ubuntu宿主机上必须预先设置系统级别的限制**：
   ```bash
   echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
   echo fs.inotify.max_user_instances=512 | sudo tee -a /etc/sysctl.conf
   sudo sysctl -p
   ```

   或者，为了立即生效而不重启系统：
   ```bash
   echo 524288 | sudo tee /proc/sys/fs/inotify/max_user_watches
   echo 512 | sudo tee /proc/sys/fs/inotify/max_user_instances
   ```

3. 重新构建并部署应用：
   ```bash
   docker-compose down
   docker-compose build
   docker-compose up -d
   ```

### 验证修复

部署后，检查日志以确认不再出现 ENOSPC 错误：
```bash
docker-compose logs -f
```

### 监控

定期监控文件监视器使用情况：
```bash
# 检查当前使用的监视器数量
find /proc/*/fd -lname anon_inode:inotify -print 2>/dev/null | wc -l

# 检查系统限制
cat /proc/sys/fs/inotify/max_user_watches
```

### 故障排除

如果仍然遇到权限错误，请注意：
- Docker容器中的sysctl参数需要宿主机支持才能设置
- 某些系统配置必须在宿主机层面进行设置
- 确保在运行容器之前已在宿主机上设置了正确的内核参数