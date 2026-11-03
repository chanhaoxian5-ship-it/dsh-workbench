# 构建、运行与维护脚本

| 文件 | 用途与注意事项 |
|---|---|
| `build_bundle.py` | 汇集基础后端、网页和插件扩展，生成tools.json和资源哈希清单。独立仓库以backend为基础；显式`--source-root`可从原工程同步。不要把运行数据加进复制范围。 |
| `service.ps1` | Windows下管理本插件服务的便捷入口，支持start/stop/restart/status/mcpConfig，参数指定绝对dataDir和Python解释器；mcpConfig还需 -ProjectDir 项目绝对目录。 |
| `control.mjs` | service.ps1背后的跨Node命令行入口，复用Controller；不是另一套服务管理实现。 |
| `mcp.py` | 给其他Agent配置的稳定stdio启动路径，定位本包backend后调用共享MCP入口。配置中需要 --project-dir 项目绝对目录，不需要端口或令牌。 |
| `publish-project.ps1` | 管理员专用原HTTP项目发布工具的PowerShell入口（使用管理凭证，普通Agent不用）；需要显式匹配服务的Port和DataDir。一般Agent优先使用MCP/DSH工具自动发现端点。 |
| `publish-discovery.ps1` | 管理员专用原HTTP发现发布工具入口（使用管理凭证），保留同一JSON与delivery_key安全重试。 |
| `maintain-backend.ps1` | SQLite检查、一致备份、新目录恢复入口；不自动迁移日常数据。 |
| `test-backend.ps1` | 在随包backend上运行Python回归测试，使用隔离数据。修改进程控制后还需执行Node集成测试。 |

常用顺序：修改维护源 → build_bundle → 对应验证 → npm pack。运行旧HTTP发布脚本时不要依赖默认8765端口；以设置页的实际地址为准，或直接采用共享Agent工具。
