const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { createReadStream, createWriteStream } = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');

const pipelineAsync = promisify(pipeline);

// 默认上传目录
let UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
// 确保UPLOAD_DIR是绝对路径
UPLOAD_DIR = path.resolve(UPLOAD_DIR);

// 导出设置上传目录的函数
exports.setUploadDir = (newUploadDir) => {
  UPLOAD_DIR = newUploadDir;
};

// 安全地解析路径，防止路径遍历攻击
const safePathJoin = (basePath, relativePath) => {
  // 处理根路径
  if (relativePath === '/' || relativePath === '') {
    return basePath;
  }

  // 确保relativePath以'/'开头
  if (!relativePath.startsWith('/')) {
    relativePath = '/' + relativePath;
  }

  // 移除URL路径中的第一个斜杠，以便正确拼接
  const pathWithoutLeadingSlash = relativePath.substring(1);
  const resolvedPath = path.resolve(basePath);
  const joinedPath = path.join(basePath, pathWithoutLeadingSlash);

  // 确保路径不会跳出上传目录（安全检查）
  const normalizedPath = path.normalize(joinedPath);

  if (!normalizedPath.startsWith(resolvedPath)) {
    throw new Error("Forbidden: Path traversal detected");
  }

  return normalizedPath;
};

// 存储WebSocket订阅管理器
let subscriptionManager = null;

// 设置订阅管理器的函数
exports.setSubscriptionManager = (manager) => {
  subscriptionManager = manager;
};

// 通知文件更改的函数
const notifyFileChange = async (eventType, filePath) => {
  if (subscriptionManager) {
    console.log(`Attempting to trigger file event: ${eventType} for ${filePath}`);

    // 确保文件完全写入后再触发事件
    try {
      // 使用fs.access来确保文件确实存在且可访问
      await fs.access(filePath, fs.constants.F_OK);

      // 添加额外的延迟以确保文件系统完全写入，这对rclone特别重要
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log(`Triggering file event: ${eventType} for ${filePath}`);
      subscriptionManager.handleFileEvent(eventType, filePath);
    } catch (accessErr) {
      console.error(`Error accessing file after write: ${accessErr.message}`);
      // 即使访问失败也尝试触发事件
      setTimeout(() => {
        console.log(`(Delayed) Triggering file event: ${eventType} for ${filePath}`);
        subscriptionManager.handleFileEvent(eventType, filePath);
      }, 200);
    }
  } else {
    console.error("subscriptionManager is not set - cannot send WebSocket notification");
  }
};

// WebDAV兼容的路由处理
const createWebDAVHandler = () => {
  // 确保上传目录存在
  fs.ensureDirSync(UPLOAD_DIR);

  return async (req, res, next) => {
    const webdavMethods = ['PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK', 'PUT', 'DELETE', 'GET', 'HEAD'];
    if (webdavMethods.includes(req.method.toUpperCase())) {
      let filePath;
      try {
        // 提取路径部分（忽略查询参数）
        const pathEnd = req.url.indexOf('?');
        const pathPart = pathEnd === -1 ? req.url : req.url.substring(0, pathEnd);
        // 安全地解析路径，防止路径遍历攻击
        filePath = safePathJoin(UPLOAD_DIR, pathPart);
      } catch (pathError) {
        console.error(`Path traversal attempt: ${req.url}`, pathError.message);
        if (req.method === 'PROPFIND') {
          const xmlResponse = '<?xml version="1.0" encoding="utf-8"?>' +
            '<D:multistatus xmlns:D="DAV:" xmlns:ns1="http://apache.org/dav/props/" xmlns:ns0="DAV:">' +
            '<D:response>' +
            `<D:href>${req.url}</D:href>` +
            '<D:propstat><D:prop><D:resourcetype/></D:prop><D:status>HTTP/1.1 403 Forbidden</D:status></D:propstat>' +
            '</D:response>' +
            '</D:multistatus>';
          res.status(207); // WebDAV标准要求PROPFIND返回207
          res.setHeader('Content-Type', 'application/xml; charset=utf-8');
          res.send(xmlResponse);
        } else {
          res.status(403).send('Forbidden');
        }
        return;
      }

      try {
        if (req.method === 'GET' || req.method === 'HEAD') {
          // 检查文件是否存在
          const exists = await fs.pathExists(filePath);
          if (!exists) {
            // 文件不存在，返回404
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
            return;
          }

          // 文件存在，获取文件状态
          const stats = await fs.stat(filePath);

          if (stats.isDirectory()) {
            // 返回目录内容
            const items = await fs.readdir(filePath);
            const resources = [{
              path: req.url,
              isDirectory: true,
              size: 0,
              mtime: stats.mtime,
              ctime: stats.ctime
            }];

            for (const item of items) {
              const itemPath = path.join(filePath, item);
              const itemStats = await fs.stat(itemPath);
              resources.push({
                path: path.posix.join(req.url, item).replace(/\\/g, '/'),
                isDirectory: itemStats.isDirectory(),
                size: itemStats.size,
                mtime: itemStats.mtime,
                ctime: itemStats.ctime
              });
            }

            // 生成PROPFIND响应
            if (req.method === 'PROPFIND') {
              const xmlResponse = generatePropfindXml(resources);
              res.status(207);
              res.setHeader('Content-Type', 'application/xml; charset=utf-8');
              res.send(xmlResponse);
            } else {
              // 简单的目录列表
              res.json({
                path: req.url,
                items: items.map(name => ({
                  name,
                  path: path.posix.join(req.url, name).replace(/\\/g, '/'),
                  isDirectory: fs.statSync(path.join(filePath, name)).isDirectory()
                }))
              });
            }
          } else {
            // 处理文件下载
            const range = req.headers.range;
            const fileSize = stats.size;

            if (range) {
              // 处理范围请求
              const parts = range.replace(/bytes=/, "").split("-");
              const start = parseInt(parts[0], 10);
              const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
              const chunksize = (end - start) + 1;

              const fileStream = createReadStream(filePath, { start, end });

              res.writeHead(206, {
                "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                "Accept-Ranges": "bytes",
                "Content-Length": chunksize,
                "Content-Type": "application/octet-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive" // 保持连接
              });

              // 使用传统pipe方法而不是pipeline，因为pipeline在某些情况下可能导致提前关闭
              fileStream.pipe(res);

              // 添加错误处理
              fileStream.on('error', (err) => {
                console.error('File stream error (range request):', err);
                if (!res.headersSent) {
                  res.status(500).send('Internal Server Error');
                }
              });

              res.on('error', (err) => {
                console.error('Response stream error (range request):', err);
                fileStream.destroy();
              });

              // 监听客户端断开连接
              req.on('close', () => {
                if (!res.finished) {
                  console.log(`Client disconnected during range download of ${filePath} (may be normal end of transfer)`);
                  fileStream.destroy(); // 清理资源
                }
              });
            } else {
              // 完整文件下载
              res.writeHead(200, {
                "Content-Type": "application/octet-stream",
                "Content-Length": fileSize,
                "Cache-Control": "no-cache",
                "Connection": "keep-alive" // 保持连接
              });

              const fileStream = createReadStream(filePath, {
                highWaterMark: 1 * 1024 * 1024 // 1MB缓冲区，减少EOF错误
              });

              // 使用传统pipe方法而不是pipeline，因为pipeline在某些情况下可能导致提前关闭
              fileStream.pipe(res);

              // 添加错误处理
              fileStream.on('error', (err) => {
                console.error('File stream error:', err);
                if (!res.headersSent) {
                  res.status(500).send('Internal Server Error');
                }
              });

              res.on('error', (err) => {
                console.error('Response stream error:', err);
                fileStream.destroy();
              });

              // 监听客户端断开连接
              req.on('close', () => {
                if (!res.finished) {
                  console.log(`Client disconnected during download of ${filePath} (may be normal end of transfer)`);
                  fileStream.destroy(); // 清理资源
                }
              });
            }
          }
        } else if (req.method === 'PUT') {
          // 处理文件上传
          const dirPath = path.dirname(filePath);
          await fs.ensureDir(dirPath);

          const fileExists = await fs.pathExists(filePath);

          const writeStream = createWriteStream(filePath, {
            highWaterMark: 1 * 1024 * 1024 // 1MB缓冲区，减少EOF错误
          });

          req.pipe(writeStream);

          writeStream.on('finish', async () => {
            await notifyFileChange(fileExists ? 'updated' : 'created', filePath);
            res.status(201).send('Created');
          });

          writeStream.on('error', (err) => {
            console.error('Error writing file:', err);
            if (!res.headersSent) {
              res.status(500).send('Internal Server Error');
            }
          });
        } else if (req.method === 'DELETE') {
          // 处理删除
          const exists = await fs.pathExists(filePath);

          if (exists) {
            await fs.remove(filePath);
            await notifyFileChange('deleted', filePath);
            res.status(200).send('OK');
          } else {
            res.status(404).send('Not Found');
          }
        } else if (req.method === 'MKCOL') {
          // 创建目录
          await fs.ensureDir(filePath);
          await notifyFileChange('directoryCreated', filePath);
          res.status(201).send('Created');
        } else if (req.method === 'PROPFIND') {
          // 属性查询
          if (await fs.pathExists(filePath)) {
            const stats = await fs.stat(filePath);
            const resources = [{
              path: req.url,
              isDirectory: stats.isDirectory(),
              size: stats.size,
              mtime: stats.mtime,
              ctime: stats.ctime
            }];
            
            if (stats.isDirectory()) {
              const items = await fs.readdir(filePath);
              for (const item of items) {
                const itemPath = path.join(filePath, item);
                const itemStats = await fs.stat(itemPath);
                resources.push({
                  path: path.posix.join(req.url, item).replace(/\\/g, '/'),
                  isDirectory: itemStats.isDirectory(),
                  size: itemStats.size,
                  mtime: itemStats.mtime,
                  ctime: itemStats.ctime
                });
              }
            }
            
            const xmlResponse = generatePropfindXml(resources);
            res.status(207);
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            res.send(xmlResponse);
          } else {
            res.status(404).send('Not Found');
          }
        } else {
          // 其他WebDAV方法暂时不支持
          res.status(405).send('Method Not Allowed');
        }
      } catch (error) {
        console.error(`Error processing ${req.method} request for ${req.url}:`, error);
        if (!res.headersSent) {
          // 对于WebDAV请求，返回WebDAV兼容的错误响应
          if (webdavMethods.includes(req.method.toUpperCase())) {
            if (error.code === 'ENOENT') { // 文件不存在
              // 对于PROPFIND请求，返回多状态响应
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
              res.status(500).send('Internal Server Error');
            }
          } else {
            // 对于非WebDAV请求，返回普通错误
            res.status(500).send('Internal Server Error');
          }
        }
      }
    } else {
      // 非WebDAV请求，调用next()
      next();
    }
  };
};

// 生成PROPFIND响应的XML
function generatePropfindXml(resources) {
  let xml = '<?xml version="1.0" encoding="utf-8"?>';
  xml += '<D:multistatus xmlns:D="DAV:" xmlns:ns1="http://apache.org/dav/props/" xmlns:ns0="DAV:">';
  
  for (const resource of resources) {
    xml += '<D:response>';
    xml += `<D:href>${resource.path}</D:href>`;
    xml += '<D:propstat>';
    xml += '<D:prop>';
    
    // 基本属性
    xml += '<D:resourcetype>' + (resource.isDirectory ? '<D:collection/>' : '') + '</D:resourcetype>';
    xml += `<D:getcontentlength>${resource.size || 0}</D:getcontentlength>`;
    xml += `<D:getlastmodified>${resource.mtime ? resource.mtime.toUTCString() : ''}</D:getlastmodified>`;
    xml += '<D:creationdate>' + (resource.ctime ? resource.ctime.toISOString() : '') + '</D:creationdate>';
    xml += '<D:getetag>"' + (resource.mtime ? resource.mtime.getTime() : Date.now()) + '"</D:getetag>';
    
    xml += '</D:prop>';
    xml += '<D:status>HTTP/1.1 200 OK</D:status>';
    xml += '</D:propstat>';
    xml += '</D:response>';
  }
  
  xml += '</D:multistatus>';
  return xml;
}

// 将WebDAV服务器集成到Express应用中
const integrateWithExpress = (app) => {
  const webdavHandler = createWebDAVHandler();
  
  // 将WebDAV处理器作为中间件添加到Express应用
  app.use(webdavHandler);
};

module.exports = {
  integrateWithExpress,
  setUploadDir: exports.setUploadDir,
  setSubscriptionManager: exports.setSubscriptionManager
};