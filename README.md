# 心印共鸣

本地优先的 AI 角色聊天桌面应用，支持本地 Ollama 与兼容 OpenAI 的云端 API。

## 开发

```powershell
npm.cmd run tauri dev
```

## 数据与隐私

- 角色、头像和聊天记录保存在应用 WebView 的本地存储中。
- API Key 只保存在当前运行的内存中；关闭应用后需要重新输入，备份文件也不会包含它。
- 可从控制台导出完整备份或不含聊天记录的角色卡。

## 从微信或 QQ 创建关系角色

1. 在模型区域连接本地 Ollama，或验证兼容 OpenAI 的云端 API。
2. 点击“从微信 / QQ 聊天记录创建关系角色”。
3. 微信可以连接用户自行安装、初始化的 `wx-cli` Windows EXE；QQ 可以检测本机 `qq-chat-exporter`，也可以直接选择其导出的 JSON。
4. 确认哪一个发言者是自己、哪一个是对方，然后开始蒸馏。
5. 审阅人格、关系、相处模式和共同故事后再创建角色。

心印共鸣不内置、下载或更新第三方导出工具，不执行 `wx init`、不主动提权、不读取数据库密钥，也不控制 QQ/NapCat 登录。微信连接器只执行固定的 `sessions --json` 和 `history ... --json` 只读命令；QQ 连接器只检测 `127.0.0.1:40653`，实际导出仍由用户在 qq-chat-exporter 中完成。

第三方工具属于独立信任边界：`wx-cli` 可能维护自己的数据库密钥和解密缓存，`qq-chat-exporter`/NapCat 可能持有 QQ 登录状态。详细边界见 [SECURITY.md](SECURITY.md)。

原始聊天只在导入过程中读取；角色卡保存经用户确认的蒸馏结果和来源统计，不保存整份原文。使用本地 Ollama 时记录不会离开电脑；使用云端模型时，抽取的聊天片段会发送给用户配置的 API 服务。

### 已解密 QQ Android NT 快照（高级）

仓库提供 `scripts/qq_nt_export.py`，用于把用户自己拥有、已经在应用之外解密并复制出的 QQ Android NT `nt_msg` 数据库快照转换为心印共鸣可直接导入的 JSON。脚本不会连接正在运行的 QQ，不会获取登录状态、推导密钥或解密数据库。

```powershell
python scripts\qq_nt_export.py `
  --database D:\path\to\nt_msg.decrypted.db `
  --self-uid <自己的 UID> `
  --peer-uid <对方的 UID> `
  --self-name "我的昵称" `
  --peer-name "对方昵称" `
  --output D:\path\to\chat-xinyin.json
```

脚本以只读模式查询复制出的快照，限制单次读取规模和字段长度，输出只包含平台、参与者统计以及 `sender`、`time`、`content` 三个消息字段。UID、原始二进制、数据库密钥、登录状态和可点击链接不会写入结果。请勿把 QQ 正在使用的数据库文件直接交给脚本。
