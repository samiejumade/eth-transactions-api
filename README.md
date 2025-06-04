# Ethereum Transaction API

This project provides a comprehensive API for interacting with Hyperledger Besu blockchain nodes, offering endpoints for transaction analysis, token operations, and price tracking.

## Project Structure

- **`consolidated_api.js`** - Main API server containing all endpoints and business logic
- **`proxy-server.js`** - Reverse proxy server for multi-port routing
- **Other files** - Testing scripts for individual endpoint validation during development

## How It Works

This implementation provides multiple endpoints for blockchain interaction:

### API Endpoints

1. **GET /api/token-graphs**
   - Fetches token price history from UniversalSwap events
   - Generates price timelines using WOX token as reference
   - Parameters: `universalContract`, `woxAddress`

2. **POST /api/token-transactions**
   - Retrieves token transfer history for a specific user
   - Scans ERC-20 Transfer events across multiple tokens
   - Returns transaction hash, from/to addresses, values, and timestamps

3. **POST /api/token-balances**
   - Gets current token balances for a user across multiple tokens
   - Handles different token decimals automatically
   - Returns both raw and formatted balance values

4. **GET /api/check-contract/:address**
   - Validates if an address is a deployed contract
   - Returns contract code information and current block number

### RPC Endpoint

- **POST /rpc** - Direct JSON-RPC calls to the Hyperledger Besu node

## Setup and Installation

### Prerequisites
- Node.js (v14 or higher)
- Hyperledger Besu node running on port 8545
- ngrok account with authtoken

### Installation

1. Install dependencies:
```bash
npm install express ethers web3 moment http-proxy-middleware
```

2. Ensure your Hyperledger Besu node is running on `http://10.7.0.30:8545`

## Running the Application

### Step 1: Start the Main API Server

Start the consolidated API server which contains all endpoints:

```bash
node consolidated_api.js
```

This will start the server on port 3000 with all API endpoints available.

### Step 2: Start the Proxy Server

In a new terminal, start the proxy server for multi-port routing:

```bash
node proxy-server.js
```

**Why we need proxy-server.js:**
The proxy server acts as a reverse proxy that routes requests to different services:
- Routes `/api/*` requests to the API server (port 3000)
- Routes `/rpc/*` requests directly to the Besu node (port 8545)
- Provides a single entry point (port 8080) for all services
- Enables seamless integration between API endpoints and direct blockchain RPC calls

### Step 3: Start ngrok

Configure your ngrok tunnel and start it:

```bash
ngrok start --all
```

This will expose your local services through the configured ngrok URL (e.g., `https://wse.ngrok.app`).

## API Usage Examples

### 1. Direct RPC Call to Besu Node

Get the current block number:

```bash
curl -X POST https://wse.ngrok.app/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Get account balance:

```bash
curl -X POST https://wse.ngrok.app/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xf17f52151EbEF6C7334FAD080c5704D77216b732","latest"],"id":1}'
```

### 2. Get Token Transactions

Retrieve token transaction history for a user:

```bash
curl -X POST https://wse.ngrok.app/api/token-transactions \
  -H "Content-Type: application/json" \
  -d '{
    "tokenAddresses": [
      "0xb9A219631Aed55eBC3D998f17C3840B7eC39C0cc",
      "0x7cb50610e7e107b09acf3FBB8724C6df3f3e1c1d"
    ],
    "userAddress": "0xf17f52151EbEF6C7334FAD080c5704D77216b732"
  }'
```

### 3. Get Token Balances

Check token balances for a user:

```bash
curl -X POST https://wse.ngrok.app/api/token-balances \
  -H "Content-Type: application/json" \
  -d '{
    "tokenAddresses": [
      "0xb9A219631Aed55eBC3D998f17C3840B7eC39C0cc",
      "0x7cb50610e7e107b09acf3FBB8724C6df3f3e1c1d"
    ],
    "userAddress": "0xf17f52151EbEF6C7334FAD080c5704D77216b732"
  }'
```

### 4. Get Token Price Graphs

Fetch token price history:

```bash
curl -X GET "https://wse.ngrok.app/api/token-graphs?universalContract=0xd95CA891eCfF265ACf2177651965a85d3B9F9a96&woxAddress=0xb9A219631Aed55eBC3D998f17C3840B7eC39C0cc"
```

### 5. Check Contract Status

Verify if an address is a deployed contract:

```bash
curl -X GET https://wse.ngrok.app/api/check-contract/0xb9A219631Aed55eBC3D998f17C3840B7eC39C0cc
```

### 6. Health Check

Check service status:

```bash
curl -X GET https://wse.ngrok.app/
```

## Response Formats

### Token Transactions Response
```json
{
  "userAddress": "0xf17f52151ebef6c7334fad080c5704d77216b732",
  "tokenCount": 2,
  "transactionCount": 15,
  "transactions": [
    {
      "token": "0xb9a219631aed55ebc3d998f17c3840b7ec39c0cc",
      "from": "0xf17f52151ebef6c7334fad080c5704d77216b732",
      "to": "0x627306090abab3a6e1400e9345bc60c78a8bef57",
      "value": "1000000000000000000",
      "transactionHash": "0x...",
      "blockNumber": 12345,
      "timestamp": 1640995200,
      "timeStamp": "2022-01-01T00:00:00.000Z"
    }
  ]
}
```

### Token Balances Response
```json
{
  "userAddress": "0xf17f52151ebef6c7334fad080c5704d77216b732",
  "balances": [
    {
      "token": "0xb9a219631aed55ebc3d998f17c3840b7ec39c0cc",
      "rawBalance": "1000000000000000000",
      "balance": 1.0,
      "decimals": 18
    }
  ]
}
```

## Performance Considerations

- The API uses chunked log retrieval to handle large block ranges efficiently
- Binary search is implemented for finding contract creation blocks
- Block scanning is optimized with configurable chunk sizes
- Error handling includes automatic retry with reduced chunk sizes

## Configuration

### Default Addresses
- **Besu Node**: `http://10.7.0.30:8545`
- **API Server**: `http://localhost:3000`
- **Proxy Server**: `http://localhost:8080`
- **Default Universal Contract**: `0xd95CA891eCfF265ACf2177651965a85d3B9F9a96`
- **Default WOX Token**: `0xb9A219631Aed55eBC3D998f17C3840B7eC39C0cc`

### Environment Variables
- `PORT`: API server port (default: 3000)

## Troubleshooting

1. **Connection Issues**: Ensure Besu node is running and accessible at `http://10.7.0.30:8545`
2. **RPC Errors**: Check if the node is synced and RPC is enabled
3. **Large Queries**: The API automatically handles large block ranges with chunking
4. **ngrok Issues**: Verify your authtoken is correctly configured in `ngrok.yml`

## Development and Testing

The repository contains additional testing files used during development to validate individual endpoints. The main production-ready code is consolidated in `consolidated_api.js`.

For production deployment, consider:
- Implementing database indexing for faster transaction lookups
- Adding caching for frequently requested data
- Setting up monitoring and logging
- Implementing rate limiting for API endpoints
