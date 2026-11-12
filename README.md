# MiMo 语音与魔搭生图

Aurabot 模块，包含小米 MiMo 音色克隆和 ModelScope 魔搭多模型生图。适用于 Aurabot 1.3.0 系列，已发布的 1.3.0-beta.1 也支持。

- [安装与使用](modules/mimo-modelscope/README.md)
- 随模块发布的 MiMo 参考音频 [懒羊羊.wav](modules/mimo-modelscope/assets/懒羊羊.wav) 可在模块面板上传。
- 模块目录为 [modules/mimo-modelscope](modules/mimo-modelscope)，可整体复制到模块市场仓库。
- 使用 Node.js 22.13 或更高版本运行 `npm test`。测试用替身响应模拟 MiMo 和魔搭，无需凭证。
- 要运行宿主集成测试，把环境变量 `MIMO_MODELSCOPE_AURABOT_CHECKOUT` 指向官方 Aurabot 源码目录，再运行 `npm test`。测试使用临时数据目录和模拟 OneBot。

模块基于 [MiMo、魔搭接入](https://github.com/oligeeklaphake/dsh-aurabot-qq/commit/4798526)与[魔搭多模型](https://github.com/oligeeklaphake/dsh-aurabot-qq/commit/243a080)两项 Aurabot 定制开发。模块代码采用 [MIT](LICENSE) 许可。
