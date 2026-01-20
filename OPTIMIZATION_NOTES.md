# SDav v0.1.10 优化说明

## CPU占用优化

在v0.1.10版本中，我们针对之前版本中CPU占用过高的问题进行了优化。

### 问题原因
- 文件监视器被设置为监视整个uploadDir目录及其所有子目录
- 使用了`usePolling: true`和较短的`interval: 1000`，导致定期轮询文件系统
- 没有过滤机制，对所有文件变化都进行处理

### 优化措施

#### 1. 环境变量控制监视路径
引入了`WATCH_PATHS`环境变量，允许指定要监视的特定路径：

```yaml
environment:
  - WATCH_PATHS=/app/uploads/docs,/app/uploads/images
```

如果不设置此变量，则默认监听整个上传目录。

#### 2. 优化chokidar配置
- 设置`usePolling: false`，使用原生文件系统事件而非轮询
- 添加`awaitWriteFinish`选项，等待文件写入完成，减少重复事件
- 添加`ignored`规则，忽略临时文件和系统文件

#### 3. 双重过滤机制
- chokidar层面：通过`WATCH_PATHS`环境变量限制监视的目录
- 应用层面：在`handleFileEvent`函数中增加`isPathInWatchedDirectories`检查，确保只有在指定路径内的文件变化才会被处理

#### 4. 性能改进
- 减少不必要的文件系统事件处理
- 优化路径匹配算法
- 添加性能指标监控

## 配置说明

### 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| WATCH_PATHS | 要监视的路径列表，用逗号分隔 | /app/uploads (整个上传目录) |

### 示例配置

监视特定目录：
```yaml
environment:
  - WATCH_PATHS=/app/uploads/documents,/app/uploads/photos
```

监视单个目录：
```yaml
environment:
  - WATCH_PATHS=/app/uploads/work
```

监视整个上传目录（默认行为）：
```yaml
environment:
  # 不设置WATCH_PATHS或设置为/app/uploads
  - WATCH_PATHS=/app/uploads
```

## 重要说明

根据最近的更新，现在不仅在chokidar层面限制监视路径，还在应用程序层面增加了额外的过滤检查。这意味着即使chokidar因为某些原因捕获了不在指定路径中的文件事件，应用程序也会在处理前再次验证该文件是否在我们想要监视的目录范围内。

## 部署建议

1. 为了获得最佳性能，请按需设置`WATCH_PATHS`环境变量，只监视实际需要同步的目录，而不是整个上传目录。

2. 如果您发现仍在处理不需要的文件事件，请检查您的`WATCH_PATHS`设置是否正确指向了您真正关心的目录。

3. 例如，如果您的日志显示正在处理`/app/uploads/docker/...`路径下的文件，但您实际上并不想监视这些文件，请确保`WATCH_PATHS`不包含该路径，或者将其设置为您实际需要监视的特定路径。