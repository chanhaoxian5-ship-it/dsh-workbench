# Windows持续集成

`test.yml`在push或pull request后，从干净的远端源码执行：

1. 准备Python3.12和Node22。
2. 重建插件，检查随包后端、前端与扩展能独立组织。
3. 运行Python后端回归。
4. 运行Node进程/MCP集成测试。
5. 执行npm打包预检。

工作流只授予contents:read，不读取用户电脑的日常数据库、DSH profile或模型凭据。GitHub runner没有DSH桌面应用，因此这份CI不声称验证了日常设置页加载；原生DSH与浏览器验证范围见docs/VALIDATION.md。
