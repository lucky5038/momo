# Momo传值助手 · 开发版

本目录由 **release/Momo传值助手 1.0.0.exe**（确认可正常运行的基线版本）提取，
当前正式版本为 **Momo传值助手 2.2.58（深空高对比主题）**。
是当前唯一的开发源码。旧的 `chuanzhi-app` 目录已删除。

## 目录说明

| 路径 | 说明 |
| --- | --- |
| `source/` | 开发源码：`src/app.js` 后端、`src/main.electron.js` 主进程、`src/public/index.html` 界面 |
| `source/node_modules/` | 运行依赖（mssql 等），随 asar 一起提取 |
| `source/public_inline.js` | 由 `src/public/index.html` 生成，改界面后需重新生成 |
| `dist-electron/` | 构建产物：便携单文件 exe + `win-unpacked/` |
| `baseline/` | 原始 release exe 备份，仅供对照，不参与开发 |
| `tools/eb/` | 本地打包工具链（electron-builder 24 + @electron/rebuild 3.2.10） |
| `build-electron.ps1` | 一键构建单文件 exe |
| `run-dev.ps1` | 一键启动开发版（跑 win-unpacked，速度快） |

## 日常流程

1. 改 `source/src/` 下的代码。
2. 改了界面就重新生成内联文件：

```powershell
node tools\regen-inline.js
```

3. 快速看效果：运行 `run-dev.ps1`。
4. 出正式包：运行 `build-electron.ps1`，会同时生成两个产物：
   - `dist-electron\Momo传值助手 2.2.43.exe`（便携版，双击即用）
   - `dist-electron\Momo传值助手 Setup 2.2.43.exe`（安装包，带安装向导，可选安装路径）

## 回归测试

```powershell
pwsh -File tools\test-persist.ps1   # 保存配置 -> 重启 -> 校验回填 + 数据库连通
node tools\test-ui-fill.js          # 读界面输入框真实值
node tools\test-trigger-sql.js      # 兜底通道触发器 SQL 纯函数回归（不连库）
node tools\audit-all.js <server> <user> <password> <db>   # 只读全链路审计（品号关联 + 链路 SQL）
```

## 配置存哪里

两种版本存放位置不同：

- **便携版**：`config.js` 写在 exe 旁边（通过 `PORTABLE_EXECUTABLE_DIR` 定位），不会写临时解压目录。
- **安装版**：`config.js` 写在 `%APPDATA%\Momo传值助手`，不会读取安装目录里的旧配置。
- 点「保存配置」才会写入；重启后界面从 `config.js` 回填服务器/账号/密码/账套。
- 全新安装（没有 config.js）时，服务器和密码为空。

## 备份路径

- 启动时不再弹目录选择框。
- 在主界面「执行（先备份）」右侧点「备份路径」，弹出原生目录选择框。
- 选完立即生效并写进 `config.js` 的 `backupDir`，按钮下方实时显示当前路径。

## 说明

- 版本号在 `source/package.json` 的 `version`，会影响 exe 文件名。
- `source/src/config.js` 是打包进 asar 的默认值；实际连接以 exe 同目录的 `config.js` 为准。
- `dist-electron\config.js` 是当前这台机器已保存的连接配置，复制 exe 到别处时不要连带复制它。

## 安装包行为

- per-user 安装（不需要管理员），默认装到 `%LOCALAPPDATA%\Programs\Momo传值助手`，向导里可改路径。
- 自动创建桌面快捷方式和开始菜单快捷方式。
- 安装时会删除安装目录里旧版本残留的 `config.js` / `first_open.flag`。
- 首次打开会弹一次「科技不是高高在上，而是服务于人民」，用 `%APPDATA%\Momo传值助手\first_open.flag` 标记，之后不再弹。
- 卸载时会一并删除 `%APPDATA%\Momo传值助手`（包括保存的连接配置），保证下次安装是全新状态。
