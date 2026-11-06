启喵 Qimiao 1.1.6

- 剪贴板保留收到的 WebP、JPEG、PNG 等原始图片数据和实际体积；历史复制、导出、WebDAV 图片同步不再统一转为 PNG，兼容旧 PNG 历史记录。
- 修复应用图标加载一直转圈；共享请求、限制并发并提供超时回退，缺失图标先显示应用首字，旧缓存失效后自动重新提取。
- macOS 改用系统原生接口读取图标，支持系统应用和资源目录中的图标，不再为每个图标启动转换进程。
- 新增自动加入新安装应用：每 30 秒及唤起窗口时检查安装目录，保留收藏、分类和排序；支持在设置中关闭，兼容扫描结果确认。
- 过滤嵌入式辅助应用和复制未完成的 macOS 安装包。

Downloads: macOS Apple Silicon / Intel, Windows x64 NSIS, Linux x64 / ARM64 (deb, rpm, AppImage).

macOS 构建使用 ad-hoc 签名；Windows 和 Linux 构建未使用商业证书签名。
