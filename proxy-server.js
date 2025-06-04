const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// Proxy /api → http://localhost:3000 (your script server)
app.use("/api", createProxyMiddleware({
  target: "http://localhost:3000",
  changeOrigin: true,
  pathRewrite: { "^/api": "" }
}));

// Proxy /rpc → http://10.7.0.30:8545 (Besu node)
app.use("/rpc", createProxyMiddleware({
  target: "http://10.7.0.30:8545",
  changeOrigin: true,
  pathRewrite: { "^/rpc": "" }
}));

app.listen(8080, () => {
  console.log("Reverse proxy running at http://localhost:8080");
});
