const express = require('express');
const Web3 = require('web3');
const moment = require('moment');

const app = express();
const port = process.env.PORT || 3000;

// Connect to your local Hyperledger Besu node
const web3 = new Web3('http://localhost:8545');

app.use(express.json());

// ERC-20 Transfer event signature
const TRANSFER_EVENT_SIGNATURE = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Function to get logs in smaller chunks to avoid RPC range limit
async function getLogsInChunks(filter, chunkSize = 2000) {
  const currentBlock = await web3.eth.getBlockNumber();
  const fromBlock = filter.fromBlock === 'latest' ? currentBlock : 
                   (typeof filter.fromBlock === 'string' ? 
                    parseInt(filter.fromBlock, 16) : filter.fromBlock);
  const toBlock = filter.toBlock === 'latest' ? currentBlock : 
                 (typeof filter.toBlock === 'string' ? 
                  parseInt(filter.toBlock, 16) : filter.toBlock);
  
  console.log(`Getting logs from block ${fromBlock} to ${toBlock} in chunks of ${chunkSize}`);
  
  let allLogs = [];
  
  for (let i = fromBlock; i <= toBlock; i += chunkSize) {
    const end = Math.min(i + chunkSize - 1, toBlock);
    console.log(`Fetching logs for blocks ${i} to ${end}`);
    
    try {
      const logs = await web3.eth.getPastLogs({
        ...filter,
        fromBlock: i,
        toBlock: end
      });
      
      allLogs = [...allLogs, ...logs];
    } catch (error) {
      console.error(`Error fetching logs for blocks ${i} to ${end}:`, error.message);
      // If the chunk is still too large, reduce it and try again
      if (error.message.includes('range limit') && chunkSize > 100) {
        console.log(`Reducing chunk size and retrying`);
        const smallerChunkLogs = await getLogsInChunks(
          { ...filter, fromBlock: i, toBlock: end }, 
          Math.floor(chunkSize / 2)
        );
        allLogs = [...allLogs, ...smallerChunkLogs];
      }
    }
  }
  
  return allLogs;
}

// Function to find a token's creation block using binary search
async function getTokenCreationBlock(tokenAddress, maxBlock = null) {
  if (!maxBlock) {
    maxBlock = await web3.eth.getBlockNumber();
  }
  
  // Start with a reasonable minimum block - adjust based on your chain
  let minBlock = 0;
  
  // Check if the token exists at the current block
  try {
    const code = await web3.eth.getCode(tokenAddress, maxBlock);
    if (code === '0x') {
      return null; // Not a contract
    }
  } catch (error) {
    console.error(`Error checking token at block ${maxBlock}:`, error.message);
    return null;
  }
  
  // Binary search to find the creation block
  while (minBlock <= maxBlock) {
    const midBlock = Math.floor((minBlock + maxBlock) / 2);
    
    try {
      const code = await web3.eth.getCode(tokenAddress, midBlock);
      
      if (code === '0x') {
        // Token doesn't exist at this block, look in later blocks
        minBlock = midBlock + 1;
      } else {
        // Token exists at this block, check earlier blocks
        maxBlock = midBlock - 1;
      }
    } catch (error) {
      console.error(`Error in binary search at block ${midBlock}:`, error.message);
      // If error, assume token doesn't exist at this block
      minBlock = midBlock + 1;
    }
  }
  
  // minBlock is now the first block where the token exists
  return minBlock;
}

// Endpoint to get token transactions for a user across multiple tokens
app.post('/token-transactions', async (req, res) => {
  const { tokenAddresses, userAddress } = req.body;
  
  // Validate input
  if (!userAddress || !web3.utils.isAddress(userAddress)) {
    return res.status(400).json({ error: 'Invalid user address' });
  }
  
  if (!tokenAddresses || !Array.isArray(tokenAddresses) || tokenAddresses.length === 0) {
    return res.status(400).json({ error: 'Token addresses must be a non-empty array' });
  }
  
  try {
    // Normalize addresses
    const normalizedUserAddress = userAddress.toLowerCase();
    const validTokenAddresses = tokenAddresses.filter(addr => web3.utils.isAddress(addr))
                                              .map(addr => addr.toLowerCase());
    
    if (validTokenAddresses.length === 0) {
      return res.status(400).json({ error: 'No valid token addresses provided' });
    }
    
    console.log(`Finding transactions for user ${normalizedUserAddress} across ${validTokenAddresses.length} tokens`);
    
    // Get current block
    const currentBlock = await web3.eth.getBlockNumber();
    
    // Process each token
    const allTransactions = [];
    
    for (const tokenAddress of validTokenAddresses) {
      console.log(`Processing token ${tokenAddress}`);
      
      // Find token creation block
      const creationBlock = await getTokenCreationBlock(tokenAddress) || 0;
      console.log(`Token ${tokenAddress} was created at block ${creationBlock}`);
      
      // Create filter for transfers from user
      const sentFilter = {
        address: tokenAddress,
        topics: [
          TRANSFER_EVENT_SIGNATURE,
          web3.utils.padLeft(normalizedUserAddress, 64),
          null
        ],
        fromBlock: creationBlock,
        toBlock: 'latest'
      };
      
      // Create filter for transfers to user
      const receivedFilter = {
        address: tokenAddress,
        topics: [
          TRANSFER_EVENT_SIGNATURE,
          null,
          web3.utils.padLeft(normalizedUserAddress, 64)
        ],
        fromBlock: creationBlock,
        toBlock: 'latest'
      };
      
      // Get logs for both filters
      const [sentLogs, receivedLogs] = await Promise.all([
        getLogsInChunks(sentFilter),
        getLogsInChunks(receivedFilter)
      ]);
      
      console.log(`Found ${sentLogs.length} sent and ${receivedLogs.length} received transfers for token ${tokenAddress}`);
      
      // Combine logs
      const tokenLogs = [...sentLogs, ...receivedLogs];
      
      // Get block timestamps for all unique blocks
      const uniqueBlockNumbers = [...new Set(tokenLogs.map(log => log.blockNumber))];
      
      const blockData = await Promise.all(
        uniqueBlockNumbers.map(async (blockNumber) => {
          const block = await web3.eth.getBlock(blockNumber);
          return { 
            blockNumber, 
            timestamp: block ? block.timestamp : 0 
          };
        })
      );
      
      // Create mapping of block number to timestamp
      const blockTimestampMap = {};
      blockData.forEach(({ blockNumber, timestamp }) => {
        blockTimestampMap[blockNumber] = timestamp;
      });
      
      // Parse logs into transaction objects
      for (const log of tokenLogs) {
        // Parse the Transfer event data
        const from = '0x' + log.topics[1].slice(26);
        const to = '0x' + log.topics[2].slice(26);
        
        // Get value from data field (for Transfer events)
        const value = web3.utils.hexToNumberString(log.data);
        
        allTransactions.push({
          token: tokenAddress,
          from,
          to,
          value,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          timestamp: blockTimestampMap[log.blockNumber],
          timeStamp: moment.unix(blockTimestampMap[log.blockNumber]).toISOString()
        });
      }
    }
    
    // Sort transactions by timestamp (descending)
    allTransactions.sort((a, b) => b.timestamp - a.timestamp);
    
    return res.json({
      userAddress: normalizedUserAddress,
      tokenCount: validTokenAddresses.length,
      transactionCount: allTransactions.length,
      transactions: allTransactions
    });
  } catch (error) {
    console.error('Error fetching token transactions:', error);
    return res.status(500).json({
      error: 'Failed to fetch token transactions. Please try again later.',
      details: error.message
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
