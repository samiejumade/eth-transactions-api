const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const cors = require('cors');


const app = express();
app.use(cors());

// Proxy /api → http://localhost:3000 (your script server)
/**
 * Configures a proxy middleware to forward requests from '/api' to a local script server
 * running on port 3000. Strips the '/api' prefix from the proxied requests.
 * 
 * @middleware
 * @route /api
 * @target http://localhost:3000
 */
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
