# 项目维护约定

## 修改流程

1. 先检查当前服务和 Git 状态。
2. 修改代码后运行语法检查和相关接口测试。
3. 更新 `CHANGELOG.md`。
4. 使用一条清晰的 Git commit 保存本次改动。
5. 配置远程仓库后再推送到 GitHub。

## Commit 命名

- `feat:` 新功能
- `fix:` Bug 修复
- `ui:` 页面和交互调整
- `docs:` 文档修改
- `refactor:` 内部结构调整
- `test:` 测试调整

## 数据安全

用户账户、Token、运行时数据和本地日志不提交到仓库。相关路径已经写入 `.gitignore`。

## 本地验证

```powershell
.\start.ps1
Invoke-RestMethod http://localhost:8799/api/health
node --check server.mjs
```
