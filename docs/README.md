# Investment Decision Quality MVP

这是项目的第一个可运行版本。它暂时不接实时行情和真实券商账户，先验证核心闭环：

```text
输入交易想法 → 生成决策卡片 → 保存证据和失效条件 → 到期复查
```

## 运行

在当前目录执行：

```powershell
python mvp.py create 600519 --action buy --reason "订单增长" --horizon medium --max-loss 10 --review-days 7
python mvp.py list
python -m unittest -v
```

`create` 会生成一个 UUID。复查时执行：

```powershell
python mvp.py review <UUID> --note "财报显示订单没有继续增长"
```

数据库默认保存在当前目录的 `investment_mvp.db`。这是一个研究和复盘原型，模拟交易和真实交易接口暂未接入。
