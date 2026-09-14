# 雀战录 — 微信小程序前端

麻将被微信审核划为敏感词，文案统一用「战绩/积分」。

## 导入与运行

1. 微信开发者工具 → 导入项目 → 选择**本仓库根目录下的 `miniprogram/`**（不是仓库根）
2. AppID：`wxd170492ee92e1a80`（已在 `project.config.json` 里配）
3. 真机调试前必须先编译（见下）

## 编译（TypeScript → JavaScript）

微信开发者工具在「导入目录」模式下**不会自动跑 TypeScript**。本项目改用**外部 tsc** 显式编译 `.ts → .js`。

```bash
cd ../frontend-build      # frontend-build/ 在仓库根目录，独立于 miniprogram/
npm install               # 装 typescript（一次性）
bash build.sh             # 把 ../miniprogram/**/*.ts 编成 .js
bash build.sh --watch     # watch 模式
```

每改 `miniprogram/**/*.ts` 后必须跑一次，IDE 才能加载最新的 `.js`。

> ⚠️ 为什么不把 `frontend-build/` 放进本仓库？它的 `node_modules/` 有 23MB typescript —— 一旦放进 `miniprogram/`，会撞小程序主包 2MB 上限。所以**编译工具链必须留在 miniprogram/ 之外**。

## 目录结构

```
miniprogram/
├── app.{ts,js,json,wxss}
├── pages/              ← 每页含 .ts（源）+ .js（产物）+ .wxml + .wxss + .json
├── utils/              ← 业务逻辑、API 封装、同步、统计、本地存储
├── images/
├── globals.d.ts        ← wx/Page/App 类型声明（不打包进运行包）
├── project.config.json ← 团队共享配置
└── project.private.config.json  ← 本地 IDE 私有配置（已被 .gitignore 排除）
```

## 后端联调

后端独立仓库 `git@github.com:Lucifer1992/mahjong_records.git`。

小程序 → 后端的请求域名在 `utils/api.ts` 的 `API_BASE` 里配。开发期可填局域网 IP，生产期必须是 HTTPS 且在微信公众平台加白名单。

## 三项核心约定（改统计相关代码必看）

1. **`record.players[0]` 就是「我」** —— 所有胜率/连胜/净胜分必须按个人视角算，不能用"全场最高分"近似
2. **每局所有玩家分数之和 == 0** —— 后端 `SCORE_NOT_BALANCED` 校验，不平衡会被 400 拒绝
3. **云端按等级分层** —— 免费用户云端只保留最近 N 个有数据的日期；本地永远全量