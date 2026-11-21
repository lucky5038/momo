D:\MOMO开发 工作副本
生成时间：2026-11-19

C 盘原开发目录已于 2026-11-19 清理；D 盘是当前唯一工作副本。
清理前已确认 D 盘包含源码、工具链、开发版、当前 2.2.74 发布包、基线、文档和 Git 历史。

已迁移：
- source\                 源码与前端、本地依赖
- tools\                  审计/测试脚本、electron-builder、tools\node 本地 Node
- dist-electron\win-unpacked\  开发版可执行目录
- dist-electron\runtime\       开发版运行配置
- releases\2.2.74\        当前发布包
- baseline\               原始基线备份
- docs\                   开发说明
- pilot\ TPADFA 客户资料试跑包（XLS + 质检报告）
- .git\                   版本历史
- 根目录 AGENTS.md、CHANGELOG.md、README.md、build-electron.ps1、run-dev.ps1

未保留（已随 C 盘原目录清理）：
- releases\archive\       2.2.33–2.2.73 旧版本，约 4.26GB
- logs\                   历史构建/调试日志
- dist-electron\ 中除 win-unpacked/runtime 外的旧构建文件

可回退的只有：
- baseline\ 原始基线 exe
- releases\2.2.74\ 当前发布包
旧版本 2.2.33–2.2.73 已不在本机。

使用：
- 启动开发版：双击“启动开发版.bat”，或在 PowerShell 执行：
  powershell -NoProfile -ExecutionPolicy Bypass -File .\run-dev.ps1
- 构建：.\build-electron.ps1（已改为使用 tools\node\bin\node.exe）

注意：
- 当前 XLS 试跑包在 pilot\tpadaf-20261119\，易助只接受 .xls。
- 运行脚本会先结束名为“Momo传值助手”的进程，再启动 D 盘开发版。
