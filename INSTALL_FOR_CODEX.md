# 给 Codex 的安装步骤

本文件只在用户明确要求安装本仓库时执行。用户要求查看或解释代码时不要自动安装。

先确认是 Windows 本地执行环境，检查 Node.js 22+、Windows 版 Codex 和已下载的 Wallpaper Engine 素材。优先使用现有 Node；必要时说明缺失条件。Python 和 Windows-MCP 都不是本壁纸项目的运行依赖。

将完整仓库克隆或解压到一个独立目录。阅读 README 中的类型、转码和本机调试端口限制。保留用户现有配置、壁纸源文件及快捷方式。运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -ValidateOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

安装器会输出实际安装路径与启动脚本路径。检查 installation.json 的产品标识、文件是否齐全，以及 config.toml 中仅新增本项目的管理块。不得打印完整用户配置、凭据或会话数据。

不要强制结束当前 Codex。告诉用户先保存工作、完全退出，再打开新建的 `Codex Wallpaper` 入口。初次完整退出是必需的，因为运行中的 Codex 无法补加调试启动参数。之后从同一入口启动会按需运行服务并恢复设置。

如果 Codex 已有其他壁纸服务或管理器，先识别现有安装，不要同时启动两个 UI 注入服务。可先完成本项目的条件检查和安装准备，再按用户的迁移意图处理旧安装。

读图与音频条件：不需要 Steam / Wallpaper Engine 常驻；需要保留下载好的本地文件。视频使用文件内的音轨，Scene/Web 只使用预览图。初次默认静音。不要把 Scene/Web 预览描述为原生场景渲染。

管理器出现后，验证搜索、分级筛选和普通聊天输入；必要时只检查本项目 UI 和样式。只允许连接严格 URL `app://-/index.html` 的目标，不能检查登录页、嵌入网页或其他应用。关闭本次任务时保留服务、背景和保存设置。

卸载时运行 `scripts/uninstall.ps1`，自定义目录须传同一 InstallRoot。只有用户要求清除设置时才使用 `-Purge`。首次发布和安装均不需要操作系统管理员权限。
