# 测试范围与运行入口

测试使用临时或隔离资料库、合成文件及临时HTTP进程，不读取日常项目。源码目录不是生产数据目录。

| 文件 | 主要覆盖 |
|---|---|
| `test_backend.py` | 发现存储、投递、修正链、HTTP认证、进程/提交边界与时间分页。 |
| `test_changes.py` | 重要变化、证据更新、关注状态、双版本冲突和回执。 |
| `test_projects.py` | 工作空间、文件、版本、反馈、任务、画布、受限读取、备份恢复与旧库升级。 |
| `test_project_board.py` | 阶段/里程碑、多版本归属、固定修订、未知日期、阶段产出竞争、重启与备份读回。 |
| `test_backend_review.py` | 后端review暴露问题的回归：极大数值、文件引用歧义、异常回执和错误备份。 |
| `test_publish.py` | 发现可靠发布、丢响应恢复、同键同内容、认证失败和PowerShell入口。 |
| `test_project_publish.py` | 项目可靠发布、确切资源读回、响应丢失恢复及维护命令。 |
| `runtime.test.mjs` | 新插件进程与MCP集成：单实例、高位端口回退、重启保留、票据、实例身份和stdio调用。 |

运行Python回归：`./scripts/test-backend.ps1`；运行插件集成：`node --test tests/runtime.test.mjs`。GitHub的Windows CI还会重建并检查npm打包。

本机原生DSH组件、官方MCP客户端与浏览器设置页的隔离验证另记录在[验证说明](../docs/VALIDATION.md)。自动化通过不替代日常desktop安装后的实际使用验收。
