# 插件图标

这组图标来自用户提供的Workbench图标设计，复制原资源使用，没有重新绘制或改变原设计。

| 文件 | 使用位置与说明 |
|---|---|
| `icon.png` | 512×512浅色PNG；`package.json.icon`指向此文件。DSH读取并转成图片数据，显示在插件列表和详情中，不依赖远程图片服务器。 |
| `icon-dark.png` | 512×512深色PNG；README的深色模式展示资源。DSH当前只读取一个icon字段，本文件不会自动替换列表图标。 |
| `icon.svg` | 浅色矢量原稿，保留供后续导出或展示，不代替主PNG入口。 |
| `icon-dark.svg` | 深色矢量原稿，与浅色版配套保留。 |

若更换图标，保持主路径不变或同步修改`package.json`的icon和`./icon`导出，并运行`python scripts/build_bundle.py`更新资源校验清单。DSH当前接受包内相对路径，图片须小于256KiB；不能将设计源目录的本机绝对路径写进发布包。
