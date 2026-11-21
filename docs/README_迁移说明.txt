D:\MOMO开发 工作副本（奶蕉助手）
更新时间：2026-11-21

C 盘原开发目录已于 2026-11-19 清理；D 盘是当前唯一工作副本。
当前版本：2.2.79；只保留当前发布包和原始基线。

目录：
- source\                 源码、前端、依赖、构建图标
- tools\                  审计/测试脚本、electron-builder、tools\node 本地 Node
- dist-electron\          最新构建产物（便携版、Setup、blockmap）
- releases\2.2.79\        当前正式发布包
- baseline\               原始基线备份
- docs\                   开发说明、开发历程、迁移说明
- .git\                   Git 历史；远程 https://github.com/lucky5038/momo.git

构建：
- 构建：powershell -NoProfile -ExecutionPolicy Bypass -File .\build-electron.ps1
- 构建后会自动重新生成 public_inline.js，并清理旧构建产物。
- 运行：dist-electron\奶蕉助手 2.2.79.exe

说明：
- 用户可见名称统一为「奶蕉助手」。
- 已部署的触发器名 trg_*_momo、变量 @momo_msg 和 appId 保留为内部兼容标识。
- 安装版首次启动会从 %APPDATA%\Momo传值助手 迁移配置和凭据到 %APPDATA%\奶蕉助手。
