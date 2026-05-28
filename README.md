# 金哨 / Aurum Watch

中文 | [English](README.en.md)

金哨是一个可部署的黄金行情与舆情影响预测 Web App，用于追踪 XAU/USD、AU9999、USD/CNH、国内外价差，以及真实新闻事件对黄金价格的潜在影响。

## 当前范围

- 按设计稿实现 Dashboard 页面。
- 暂不提供 Settings 页面；所有配置通过后端 `.env` 管理。
- 只使用真实数据，不生成 mock 行情、mock 新闻或 mock 预测数据。
- OANDA 提供 XAU/USD 和 USD/CNH；只需要配置 `OANDA_API_TOKEN`，后端会自动从 OANDA 查询可用账户 ID。
- GDELT 提供真实新闻事件。
- AU9999 从 AKTools 的 `spot_quotations_sge(symbol="Au99.99")` 读取。
- SQLite 持久化行情快照和新闻事件。
- 已包含 PWA manifest、service worker、离线兜底页和 Docker Compose。

## 本地开发

```bash
bun install
cp .env.example .env
bun run dev
```

打开 `http://localhost:5173`。

OANDA 配置写入 `.env`：

```ini
OANDA_API_TOKEN=your-token
OANDA_ENV=practice
REFRESH_INTERVAL_MS=1000
```

只有使用 OANDA 实盘账户时才把 `OANDA_ENV` 改成 `live`。
`REFRESH_INTERVAL_MS` 控制后端真实数据轮询间隔，默认 1000 毫秒。

AU9999 配置：

```bash
pip install aktools
python -m aktools --host 0.0.0.0 --port 8080
```

然后在 `.env` 设置：

```ini
AKTOOLS_BASE_URL=http://127.0.0.1:8080
AKTOOLS_AU9999_SYMBOL=Au99.99
```

AKTools 会把 AKShare 函数暴露为 HTTP 接口，本项目会请求 `/api/public/spot_quotations_sge?symbol=Au99.99`。

## 生产构建

```bash
bun run build
node dist-server/index.js
```

生产服务监听 `http://localhost:8787`，同时提供 `/api/*`、`/ws` 和构建后的前端页面。

## Docker

```bash
docker compose up --build
```
