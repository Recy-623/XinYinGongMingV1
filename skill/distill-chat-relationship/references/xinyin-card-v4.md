# 心印共鸣 v4 角色卡规范

## 蒸馏档案输入

`scripts/build_xinyin_card.py` 接收以下 JSON 对象：

```json
{
  "name": "对方显示名",
  "personality": "跨时间稳定的人格与互动特征",
  "speechStyle": ["短句连发", "常用轻松吐槽缓冲认真话题"],
  "relationshipSummary": "聊天能够证实的关系摘要",
  "relationshipEvidence": {
    "observedStage": "高亲密朋友 / 情绪陪伴型搭档",
    "summary": "支持证据、反证和边界摘要",
    "confidence": 0.84
  },
  "relationshipPreset": {"id": "unspecified", "customContext": ""},
  "interactionPatterns": ["共同活动通常是联系入口"],
  "nicknames": ["只保留稳定且不敏感的共同称呼"],
  "sharedJokes": ["只写梗的概括，不复制原句"],
  "boundaries": ["不得冒充现实中的本人"],
  "uncertainties": ["没有证据确认恋爱关系"],
  "memories": [{
    "time": "2025-01-03",
    "title": "长空窗后的重连",
    "summary": "事件概括，不含原句",
    "emotionalMeaning": "它如何改变关系",
    "keywords": ["重连", "陪伴"],
    "confidence": 0.95
  }],
  "sourceMetadata": {
    "platform": "QQ",
    "fileName": "chat.json",
    "totalMessages": 1000,
    "analyzedMessages": 200,
    "selfName": "我",
    "otherName": "对方",
    "distilledAt": "2026-07-15T21:44:32+08:00"
  }
}
```

## 关系预设

允许：`unspecified`、`acquaintance`、`friend`、`close-friend`、`ambiguous`、`romantic-partner`、`family`、`colleague`、`custom`。

关系预设是用户希望延续的相处方式，不是聊天证据。用户没有明确选择时必须使用 `unspecified`。只有 `custom` 可以填写 `customContext`。

## 卡片输出

脚本生成 `xinyin-card-v4`、唯一 `id`、安全默认头像、身份边界系统提示、空 `history`、`profile`、`relationship`、`memories` 和 `sourceMetadata`。

不得放入原始聊天、账号、UID、电话号码、URL、媒体或数据库路径、登录数据、未经证实的现实身份和承诺，也不得把 `relationshipPreset` 伪装成 `relationshipEvidence`。

## 项目兼容校验

心印共鸣源码可用时运行：

```powershell
$env:CARD_PATH = "<card.json>"
node --input-type=module -e "import fs from 'node:fs'; import { readCard } from './src/storage.js'; const c=readCard(JSON.parse(fs.readFileSync(process.env.CARD_PATH,'utf8'))); console.log(JSON.stringify({name:c.name, history:c.history.length, version:'xinyin-card-v4'}));"
```

通过条件：返回角色名，`history` 为 `0`，且没有抛出格式错误。
