# 心印共鸣 V4.9 Android

仅通过用户配置的 HTTPS 模型 API 运行的 Android 版心印共鸣。它不依赖 Ollama，不访问电脑上的微信、QQ 数据库，也不内置第三方聊天提取器。

## 已实现

- OpenAI Responses API 与兼容 OpenAI Chat Completions 的 HTTPS 服务。
- 角色创建、角色卡导入导出、完整数据备份、角色聊天和关系聊天蒸馏。
- System Prompt 最多 50,000 字符；首页可删除当前选中的角色及其本地聊天记录，并要求不可撤销确认。
- 聊天中的 `[...]` 与 `【...】` 被视为仅本轮有效的导演层控制信号：界面保留原文，模型用户历史会逐轮净化，纯导演消息以“角色内保持沉默”代替台词。
- 从 Android 文件选择器导入微信、QQ 或其他工具导出的 JSON、TXT、HTML、MHT、CSV。
- 手机安全区、抽屉导航、系统返回键、软键盘输入区和分享面板适配。
- API Key 使用用户密码经 Argon2id 派生密钥，再以 AES-256-GCM 加密后保存到应用私有目录；也可只在本次运行内存中使用。

## 使用

1. 安装 APK，打开“模型 API”。
2. 选择 OpenAI Responses 或兼容 Chat Completions，填写 HTTPS 地址、模型和 API Key。
3. 可先测试连接，再保存；不希望落盘时不要勾选“加密保存”。
4. 导入聊天记录蒸馏前，应用会显示目标 API 域名和将要发送的消息上限，必须再次确认。

OpenAI Responses 请求显式设置 `store: false`。兼容服务如何保存请求由对应服务商决定，请在上传私人聊天前阅读其隐私政策。

## 隐私边界

- API Key 不写入角色卡、完整备份、日志或前端持久状态。
- 原始聊天文件仅在导入页面内存中解析；生成的角色卡只保留摘要、关系判断和来源统计，不保存整份原文。
- 关系蒸馏最多向 API 均匀抽取 800 条双方消息，不会静默上传整份文件。
- 只有用户有权访问并获得相关参与者同意的数据才应导入。

更完整的威胁边界见 [SECURITY.md](SECURITY.md)。

## 开发与构建

```powershell
npm install
npm test
npm run build
npm run tauri android build -- --apk --target aarch64
```

Android 构建需要 JDK 17、Android SDK、NDK 和 Rust Android 目标。仓库中的 `.tooling` 仅用于本机可复现构建并已被 Git 忽略。

本机 release APK 的私钥位于 `.tooling/signing`，密码只以当前 Windows 用户可解密的 DPAPI 密文保存。若要让后续 APK 直接覆盖安装本版本，必须安全备份该目录；不要提交到 Git 或发给他人。正式上架应用商店前应改用专门的生产签名密钥。

仓库保留的 `scripts/qq_nt_export.py` 是高级离线转换工具，只读取用户事先在应用外准备好的已解密数据库快照；APK 不会调用它。
