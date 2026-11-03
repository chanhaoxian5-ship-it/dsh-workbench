# 插件列表的名称与简介

`en.json`和`zh.json`中的`meta.title`、`meta.description`用于DSH插件列表及详情页。它们是展示文字，不修改插件技术身份`@chanhaoxian5/dsh-workbench`，也不修改工具名称或服务行为。

DSH通过包导出的`./locale/en.json`发现语言目录，再读取同目录的其他语言文件。`package.json.description`提供未读取语言文件时的说明。要增加语言，在这里添加相应JSON文件；`./locale/*.json`导出已经覆盖该形式。

简介只描述现有能力：本机项目资料与版本管理、随包前后端、设置启停、共享MCP。不要将尚未接入的双轨真实映射、整批检查点等写成已完成功能。
