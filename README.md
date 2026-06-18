# 校园二手交易平台

基于 Express.js、EJS 和 MySQL 的校园二手物品交易平台，面向学生发布闲置物品、浏览购买商品和管理交易记录，管理员可管理用户、商品和订单。

## 技术栈

- Node.js + Express.js
- EJS 服务端渲染
- MySQL 8.0
- express-session 会话管理
- multer 图片上传
- bcryptjs 密码加密

## 功能

- 手机号注册、登录、退出
- 商品发布，支持最多 6 张 JPG/PNG 图片
- 商品列表，支持关键词搜索和价格/时间排序
- 商品详情和立即购买
- 订单记录，区分买入和卖出
- 管理后台，支持用户、商品、订单管理
- 基础 CSRF 防护和会话 Cookie 安全配置

## 启动

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
copy .env.example .env
```

根据本机 MySQL 修改 `.env` 中的 `DB_USER`、`DB_PASSWORD`、`DB_NAME` 和 `SESSION_SECRET`。

3. 启动服务

```bash
npm start
```

访问 `http://localhost:3000`。

## 默认管理员

- 手机号：`17359050190`
- 密码：`123456`

应用启动时会自动创建数据库、表和默认管理员。也可以手动执行 `database/schema.sql` 初始化数据库结构。

## 目录

```text
app.js
database/schema.sql
src/config/
src/views/
src/public/uploads/
```
