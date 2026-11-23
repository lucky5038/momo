# N-B助手

本目录为 C 盘迁移出的工作目录；C 盘原目录已于 2026-11-19 清理。
当前版本为 **N-B助手 2.2.90（模板批注驱动的数据清洗 + 稳定模板库 + 供应商代码转换）**；构建产物在 `dist-electron/`，正式包在 `releases/2.2.90/`。按用户要求，从 2.2.87 起同时保留当前版和上一版的可双击发布包。不再保留开发版目录。

## 目录说明

| 路径 | 说明 |
| --- | --- |
| `source/` | 开发源码：`src/app.js` 后端、`src/main.electron.js` 主进程、`src/public/index.html` 界面 |
| `source/node_modules/` | 运行依赖（mssql 等），随 asar 一起提取 |
| `source/public_inline.js` | 由 `src/public/index.html` 生成，改界面后需重新生成 |
| `dist-electron/` | 最后一次构建产物（便携版、Setup、blockmap） |
| `releases/2.2.90/` | 当前正式发布包：便携版、安装包、blockmap |
| `releases/2.2.89/` | 上一版正式发布包，保留用于快速回退 |
| `docs/` | 开发历程、工具作用与研发说明 |
| `baseline/` | 原始 release exe 备份，仅供对照，不参与开发 |
| `tools/eb/` | 本地打包工具链（electron-builder 24 + @electron/rebuild 3.2.10） |
| `tools/node/` | 本地 Node 运行时，构建脚本使用；不提交 git |
| `build-electron.ps1` | 一键构建，构建前自动重新生成 `public_inline.js` |

## 日常流程

1. 改 `source/src/` 下的代码。
2. 改了界面就重新生成内联文件：

```powershell
.\tools\node\bin\node.exe tools\regen-inline.js
```

3. 构建并验证：运行 `build-electron.ps1`，在 `dist-electron/` 生成：
   - `N-B助手 2.2.90.exe`（便携版，双击即用）
   - `N-B助手 Setup 2.2.90.exe`（安装包，带安装向导，可选安装路径）
   构建完成后直接运行便携版验证；不再保留开发版/win-unpacked。
4. 更新 `releases/2.2.90/` 为当前构建产物，同时保留 `releases/2.2.89/` 作为上一版回退包。

## 回归测试

```powershell
.\tools\node\bin\node.exe tools\test-trigger-sql.js      # 触发器 SQL 纯函数回归（不连库）
.\tools\node\bin\node.exe tools\test-trigger-merge.js    # 触发器合并回归
.\tools\node\bin\node.exe tools\test-chain-category.js   # 类别关联回归
.\tools\node\bin\node.exe tools\test-chain-merge.js      # 合并显示回归
pwsh -File tools\audit-links.ps1   # 只读全链路审计（需要 sqlcmd）
```

## 配置存哪里

两种版本存放位置不同：

- **便携版**：`config.js` 写在 exe 旁边（通过 `PORTABLE_EXECUTABLE_DIR` 定位），不会写临时解压目录。
- **安装版**：`config.js` 写在 `%APPDATA%\N-B助手`，不会读取安装目录里的旧配置。
- 从旧版升级时，如果新目录还没有配置，启动会依次从 `%APPDATA%\奶蕉助手`、`%APPDATA%\Momo传值助手` 迁移 config、凭据、触发器注册表和引导标志，旧目录保留以便回退。
- 点「保存配置」才会写入；重启后界面从 `config.js` 回填服务器/账号/密码/账套。
- 全新安装（没有 config.js）时，服务器和密码为空。

## 备份路径

- 启动时不再弹目录选择框。
- 在主界面「执行（先备份）」右侧点「备份路径」，弹出原生目录选择框。
- 选完立即生效并写进 `config.js` 的 `backupDir`，按钮下方实时显示当前路径。

## 说明

- 版本号在 `source/package.json` 的 `version`，会影响 exe 文件名。
- 工具触发器名统一为 `trg_*_nb`，错误变量为 `@nb_msg`；连接数据库时会自动把旧 `trg_*_momo` 原地改名，不重建、不丢定义。
- `appId` 使用 `com.nb.assistant`，作为 N-B助手 的独立安装标识；不再沿用旧品牌的应用身份。
- `source/src/config.js` 是打包进 asar 的默认值；实际连接以 exe 同目录的 `config.js` 为准。
- `dist-electron/` 不再存放 `config.js`；连接配置由应用写到便携版 exe 同目录或安装版的 `%APPDATA%\N-B助手`。

## 安装包行为

- per-user 安装（不需要管理员），默认装到 `%LOCALAPPDATA%\Programs\N-B助手`，向导里可改路径。
- 自动创建桌面快捷方式和开始菜单快捷方式。
- 安装时会删除安装目录里旧版本残留的 `config.js` / `first_open.flag`。
- 首次打开会弹一次「科技不是高高在上，而是服务于人民」，用 `%APPDATA%\N-B助手\first_open.flag` 标记，之后不再弹。
- 卸载时会一并删除 `%APPDATA%\N-B助手`（包括保存的连接配置），保证下次安装是全新状态。
