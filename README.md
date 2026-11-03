# DSH Workbench

一个包含前端、本地后端、DSH设置管理页、Agent工具和stdio MCP的独立插件包。

```text
DSH 设置 → 原生 Connection/Gateway → Workbench宿主服务
                                      ├─ 启动/停止/重启 Python 子进程
                                      ├─ 注册4个Agent工具 + 随包操作规程
                                      └─ 生成单次工作台连接链接

随包前端 ───────── HTTP / 127.0.0.1:高位端口 ──┐
DSH 工具 ── 共享Agent适配层 ───────────────────┤ 本地后端 → 同一SQLite
其他Agent ── stdio MCP ── 共享Agent适配层 ─────┘             原文件仍在原目录
```

## 使用形态

- **DSH管理入口**：设置里的「Workbench 工作台」，可启动、停止、重启、刷新状态、打开随包工作台、显示其他Agent需要的MCP配置。
- **前后端一起打包**：`backend/workbench`包含已复核的Python后端与现有完整前端；不需要另开前端开发服务。
- **本机服务**：仅监听127.0.0.1。在49152–65535段随机直接绑定，占用时换候选；记录实际地址供客户端发现。不依赖常见固定端口。
- **数据独立**：默认`~/.dsh/storages/workbench`，不写进插件安装目录。停服务、更新或卸载插件不会删除项目记录。
- **MCP不另占端口**：客户端启动`python scripts/mcp.py --data-dir <绝对目录>`，通过标准输入输出与同一后端交互。后端关闭时不会擅自唤起。
- **不会自动启动**：autoStart默认false。后端一旦明确启动，关闭DSH后仍可供其他Agent使用；停止是明确操作。
- **打开即连接**：设置页生成30秒、单次有效的启动票据。永久令牌不进入URL、MCP配置、模型参数或日志；页面使用后立即清除fragment。

## 要求与安装

已针对 **DSH 0.2.1-rc.5、Windows、Python 3.12** 验证。DSH插件使用宿主已带的tools、skills、Connection和Remote协议；不要再安装另一份工具运行时。

后端是随包Python源码，**不包含Python解释器**。本机已有`python`即可，无第三方Python依赖；可以在插件配置指定完整`pythonPath`。MCP本身也只使用Python标准库。

详见 [安装、数据接入和回退](docs/INSTALL.md)。私有仓库访问需要你的GitHub权限；不发布到公共npm。

## Agent怎么用

先读 [AGENT_GUIDE.md](docs/AGENT_GUIDE.md)。这份文档也作为`workbench-agent-guide`在DSH中供模型和用户加载。

| 工具 | 用途 |
|---|---|
| workbench_service_status | 核对实际服务身份与健康状态；不启停 |
| workbench_read | 查询白名单`/v1`路径，包括board、文件、修订、回执与搜索 |
| workbench_publish_project | 按现有v1契约可靠登记/更新项目资料，回执与确切修订读回 |
| workbench_publish_discovery | 可靠交付带来源、会话与核验声明的发现 |

DSH与MCP工具参数/结果共用同一Python适配层。项目写入仍为逐操作事务，不冒充整批检查点。重要变化可通过查询工具读取，关注状态写入尚未封装为MCP工具。

## 开发与验证

```powershell
python scripts/build_bundle.py
./scripts/test-backend.ps1
node --test tests/runtime.test.mjs
./scripts/service.ps1 -Action status
```

独立仓库内`backend/`是随包基础源码，`python/workbench/`维护进程与Agent/MCP扩展；build_bundle同步扩展和资源清单。原Workbench工程可用`--source-root <工程绝对目录>`重新打包后端和现有前端。所有测试用隔离数据，不读取日常库。

验证范围与限制见 [VALIDATION.md](docs/VALIDATION.md)。日常desktop未自动安装/重启，当前双轨前端数据映射、整批检查点和来源有效状态仍是已有未完成项，不因打包而声称完成。原V0采集/草稿桥接插件仍在原工程保留，新包不自动迁移其策略或草稿。
