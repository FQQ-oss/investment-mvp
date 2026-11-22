# A 股真实数据 MVP

这是对原静态原型的升级方向。它增加了本地 Node 后端，通过 A 股行情适配层读取实时行情和日线 K 线，再由网页展示研究快照。

## 运行

```powershell
cd C:\Users\HP\Documents\Codex\2026-11-19\github-mcp-server-https-github-com\work\investment_mvp
$env:TUSHARE_TOKEN="你的 Tushare Pro Token"
node server.mjs
```

打开：

```text
http://localhost:8787
```

接口：

```text
GET /api/quote?symbol=600519
GET /api/history?symbol=600519
```

当前只读取公开行情，不执行交易，不保存券商凭证。下一步接入公告、财报和时间截面存储，避免把未来信息带入历史评测。

## 数据源优先级

```text
设置 TUSHARE_TOKEN → 使用 Tushare Pro
未设置 Token      → 尝试公开行情接口
```

如果未设置 Token，实时数据依赖本机网络能否访问公开接口。正式使用建议设置 Tushare Pro Token。

## Tushare 配置

PowerShell 中执行：

```powershell
$env:TUSHARE_TOKEN="你的 Tushare Pro Token"
```

然后启动：

```powershell
.\start.ps1
```

检查数据源：

```powershell
Invoke-RestMethod http://localhost:8799/api/health
```

返回中的 `dataSource` 应为 `tushare`。实时日线和分钟行情需要 Tushare 对应权限，普通 `daily` 接口主要用于历史日线。
