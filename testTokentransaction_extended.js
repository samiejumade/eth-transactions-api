const express = require('express');
const Web3 = require('web3');
const moment = require('moment');

const app = express();
const port = process.env.PORT || 3000;

// Connect to your local Hyperledger Besu node
const web3 = new Web3('http://localhost:8545');

app.use(express.json());

// ERC-20 ABI for balanceOf and decimals functions
const ERC20_ABI = [
  {
    "constant": true,
    "inputs": [{"name": "_owner", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"name": "balance", "type": "uint256"}],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "decimals",
    "outputs": [{"name": "", "type": "uint8"}],
    "type": "function"
  }
];

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

// Keep the original token-transactions endpoint
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



// Function to get token balances for a user
async function getTokenBalances(userAddress, tokenAddresses) {
  const balances = [];
  
  for (const tokenAddress of tokenAddresses) {
    try {
      const tokenContract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
      
      // Get token decimals
      let decimals = 18; // Default to 18 if we can't get decimals
      try {
        decimals = await tokenContract.methods.decimals().call();
      } catch (error) {
        console.warn(`Could not get decimals for token ${tokenAddress}, using default 18`);
      }
      
      // Get user's balance
      const balance = await tokenContract.methods.balanceOf(userAddress).call();
      
      // Convert to human-readable format
      const formattedBalance = balance / (10 ** decimals);
      
      balances.push({
        token: tokenAddress,
        rawBalance: balance,
        balance: formattedBalance,
        decimals
      });
    } catch (error) {
      console.error(`Error getting balance for token ${tokenAddress}:`, error.message);
      balances.push({
        token: tokenAddress,
        rawBalance: '0',
        balance: 0,
        decimals: 18,
        error: error.message
      });
    }
  }
  
  return balances;
}

// Function to calculate price from transfer events
function calculatePriceFromTransfers(logs) {
  // Sort logs by block number and transaction index
  logs.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber - b.blockNumber;
    }
    return a.transactionIndex - b.transactionIndex;
  });
  
  const priceData = [];
  
  // Track token supply and calculate price based on transfers
  let tokenSupply = web3.utils.toBN('0');
  
  for (const log of logs) {
    // Parse the Transfer event data
    const from = '0x' + log.topics[1].slice(26).toLowerCase();
    const to = '0x' + log.topics[2].slice(26).toLowerCase();
    const value = web3.utils.toBN(log.data);
    
    // Calculate price based on token flow
    // This is a simplified model - in reality, price calculation would be more complex
    // and likely based on exchange events rather than all transfers
    
    // If from is zero address, this is a mint (increases supply)
    if (from === '0x0000000000000000000000000000000000000000') {
      tokenSupply = tokenSupply.add(value);
    } 
    // If to is zero address, this is a burn (decreases supply)
    else if (to === '0x0000000000000000000000000000000000000000') {
      tokenSupply = tokenSupply.sub(value);
    }
    
    // Calculate a simple price metric (this is just an example)
    // In a real scenario, you'd use actual exchange rates or liquidity pool data
    let price = 0;
    if (!tokenSupply.isZero()) {
      // This is a very simplified price model
      // In reality, you'd use DEX data or other price oracles
      price = 100 / Number(web3.utils.fromWei(tokenSupply));
    }
    
    priceData.push({
      price,
      time: log.timestamp * 1000, // Convert to milliseconds for JS Date
      timeFormatted: moment.unix(log.timestamp).toISOString(),
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash
    });
  }
  
  return priceData;
}

// Endpoint to get token balances for a user
app.post('/token-balances', async (req, res) => {
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
    
    // Get token balances
    const balances = await getTokenBalances(normalizedUserAddress, validTokenAddresses);
    
    return res.json({
      userAddress: normalizedUserAddress,
      balances
    });
  } catch (error) {
    console.error('Error fetching token balances:', error);
    return res.status(500).json({
      error: 'Failed to fetch token balances. Please try again later.',
      details: error.message
    });
  }
});

// Endpoint to get price graph data for a token
app.get('/token-graph/:tokenAddress', async (req, res) => {
  const { tokenAddress } = req.params;
  
  // Validate token address
  if (!tokenAddress || !web3.utils.isAddress(tokenAddress)) {
    return res.status(400).json({ error: 'Invalid token address' });
  }
  
  try {
    const normalizedTokenAddress = tokenAddress.toLowerCase();
    
    // Find token creation block
    const creationBlock = await getTokenCreationBlock(normalizedTokenAddress) || 0;
    console.log(`Token ${normalizedTokenAddress} was created at block ${creationBlock}`);
    
    // Create filter for all transfers of this token
    const transferFilter = {
      address: normalizedTokenAddress,
      topics: [TRANSFER_EVENT_SIGNATURE],
      fromBlock: creationBlock,
      toBlock: 'latest'
    };
    
    // Get all transfer logs
    const transferLogs = await getLogsInChunks(transferFilter);
    console.log(`Found ${transferLogs.length} transfer events for token ${normalizedTokenAddress}`);
    
    // Get block timestamps for all unique blocks
    const uniqueBlockNumbers = [...new Set(transferLogs.map(log => log.blockNumber))];
    
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
    
    // Add timestamps to logs
    const logsWithTimestamps = transferLogs.map(log => ({
      ...log,
      timestamp: blockTimestampMap[log.blockNumber]
    }));
    
    // Calculate price data from transfers
    const fullPriceData = calculatePriceFromTransfers(logsWithTimestamps);
    
    // Simplify the response format to only include price and time
    const simplifiedPriceData = fullPriceData.map(dataPoint => ({
      price: dataPoint.price,
      time: dataPoint.time,
      timeFormatted: dataPoint.timeFormatted
    }));
    
    // Return only the simplified price data array
    return res.json(simplifiedPriceData); 
  } catch (error) {
    console.error('Error generating token graph data:', error);
    return res.status(500).json({
      error: 'Failed to generate token graph data. Please try again later.',
      details: error.message
    });
  }
});



// Endpoint to get price graph data for multiple tokens
app.post('/token-graphs', async (req, res) => {
  const { tokenAddresses } = req.body;
  
  // Validate input
  if (!tokenAddresses || !Array.isArray(tokenAddresses) || tokenAddresses.length === 0) {
    return res.status(400).json({ error: 'Token addresses must be a non-empty array' });
  }
  
  try {
    // Normalize and validate addresses
    const validTokenAddresses = tokenAddresses
      .filter(addr => web3.utils.isAddress(addr))
      .map(addr => addr.toLowerCase());
    
    if (validTokenAddresses.length === 0) {
      return res.status(400).json({ error: 'No valid token addresses provided' });
    }
    
    // Process each token in parallel
    const results = await Promise.all(
      validTokenAddresses.map(async (tokenAddress) => {
        try {
          // Find token creation block
          const creationBlock = await getTokenCreationBlock(tokenAddress) || 0;
          console.log(`Token ${tokenAddress} was created at block ${creationBlock}`);
          
          // Create filter for all transfers of this token
          const transferFilter = {
            address: tokenAddress,
            topics: [TRANSFER_EVENT_SIGNATURE],
            fromBlock: creationBlock,
            toBlock: 'latest'
          };
          
          // Get all transfer logs
          const transferLogs = await getLogsInChunks(transferFilter);
          console.log(`Found ${transferLogs.length} transfer events for token ${tokenAddress}`);
          
          // Get block timestamps for all unique blocks
          const uniqueBlockNumbers = [...new Set(transferLogs.map(log => log.blockNumber))];
          
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
          
          // Add timestamps to logs
          const logsWithTimestamps = transferLogs.map(log => ({
            ...log,
            timestamp: blockTimestampMap[log.blockNumber]
          }));
          
          // Calculate price data from transfers
          const fullPriceData = calculatePriceFromTransfers(logsWithTimestamps);
          
          // Simplify the response format to only include price and time
          const simplifiedPriceData = fullPriceData.map(dataPoint => ({
            price: dataPoint.price,
            time: dataPoint.time,
            timeFormatted: dataPoint.timeFormatted
          }));
          
          return {
            token: tokenAddress,
            priceData: simplifiedPriceData
          };
        } catch (error) {
          console.error(`Error processing token ${tokenAddress}:`, error.message);
          return {
            token: tokenAddress,
            error: error.message,
            priceData: []
          };
        }
      })
    );
    
    // Format the response as an object with token addresses as keys
    const formattedResults = {};
    results.forEach(result => {
      formattedResults[result.token] = result.priceData;
    });
    
    return res.json(formattedResults);
  } catch (error) {
    console.error('Error generating token graph data:', error);
    return res.status(500).json({
      error: 'Failed to generate token graph data. Please try again later.',
      details: error.message
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
