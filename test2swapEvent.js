
//#########Old script that was fetching data from the blockchain #########


const express = require('express');
const { ethers } = require('ethers');
const Web3 = require('web3');
const moment = require('moment');
const cors = require('cors');


const app = express();
const port = process.env.PORT || 3000;
app.use(cors());

// Connect to your local Hyperledger Besu node
const web3 = new Web3('http://10.7.0.30:8545');

app.use(express.json());

// Helper function to get provider
function getProvider() {
  // Make sure this is connecting to the same node as your original code
  return new ethers.JsonRpcProvider('http://10.7.0.30:8545');
}

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

// Helper to find the first block where a contract has code
async function findFirstCodeBlock(token, provider) {
  let minBlock = 0;
  let maxBlock = await provider.getBlockNumber();
  
  while (minBlock <= maxBlock) {
    const midBlock = Math.floor((minBlock + maxBlock) / 2);
    
    try {
      const code = await provider.getCode(token, midBlock);
      
      if (code === '0x') {
        // Contract doesn't exist at this block, look in later blocks
        minBlock = midBlock + 1;
      } else {
        // Contract exists at this block, check earlier blocks
        maxBlock = midBlock - 1;
      }
    } catch (error) {
      console.error(`Error in binary search at block ${midBlock}:`, error.message);
      // If error, assume contract doesn't exist at this block
      minBlock = midBlock + 1;
    }
  }
  
  return minBlock;
}

// Helper to get token's first appearance block
async function getTokenCreationBlock(token, provider) {
  try {
    const code = await provider.getCode(token, "earliest");
    return code === "0x"
      ? await findFirstCodeBlock(token, provider)
      : 0;
  } catch {
    return 0;
  }
}

// Function to find a token's creation block using binary search for Web3
async function getTokenCreationBlockWeb3(tokenAddress, maxBlock = null) {
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

// Function to get logs in smaller chunks to avoid RPC range limit for Web3
async function getLogsInChunksWeb3(filter, chunkSize = 2000) {
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
        const smallerChunkLogs = await getLogsInChunksWeb3(
          { ...filter, fromBlock: i, toBlock: end }, 
          Math.floor(chunkSize / 2)
        );
        allLogs = [...allLogs, ...smallerChunkLogs];
      }
    }
  }
  
  return allLogs;
}

// Adaptive chunking with retries for ethers.js
async function getLogsInChunks(provider, filter, maxChunk = 5000) {
  let fromBlock = filter.fromBlock;
  const toBlock = filter.toBlock;
  const logs = [];

  while (fromBlock <= toBlock) {
    const chunkTo = Math.min(Number(fromBlock) + maxChunk, Number(toBlock));

    try {
      const chunkLogs = await provider.getLogs({
        ...filter,
        fromBlock,
        toBlock: chunkTo
      });

      logs.push(...chunkLogs);
      fromBlock = chunkTo + 1;
      maxChunk = 5000; // Reset on success
    } catch (error) {
      if (maxChunk <= 100) throw error;
      maxChunk = Math.floor(maxChunk / 2);
    }
  }

  return logs;
}  

async function getAllUniversalSwapEvents(universalSwapContract) {
  const provider = getProvider();
  if (!provider) return [];

  if (!ethers.isAddress(universalSwapContract)) throw new Error("Invalid contract address");

  // Define the UniversalSwapDone event
  const iface = new ethers.Interface([
    "event UniversalSwapDone(address swapper,address _tokenIn,address _tokenOut,uint256 inAmount,uint256 outAmount)"
  ]);

  const eventTopic = iface.getEvent("UniversalSwapDone")?.topicHash;

  // Find creation block for more efficient log querying
  const creationBlock = await getTokenCreationBlock(universalSwapContract, provider);
  const toBlock = await provider.getBlockNumber();

  // Get logs
  const logs = await getLogsInChunks(provider, {
    address: universalSwapContract,
    topics: [eventTopic],
    fromBlock: creationBlock,
    toBlock
  });

  // Extract unique block numbers
  const blockNumbers = [...new Set(logs.map(log => log.blockNumber))];
  const blockData = await Promise.all(
    blockNumbers.map(async (blockNumber) => {
      const block = await provider.getBlock(blockNumber);
      return { blockNumber, timestamp: block?.timestamp };
    })
  );

  const blockTimestampMap = blockData.reduce((acc, { blockNumber, timestamp }) => {
    acc[blockNumber] = timestamp;
    return acc;
  }, {});

  // Parse logs
  const parsedEvents = logs.map(log => {
    const parsed = iface.parseLog(log);
    return {
      swapper: parsed?.args.swapper,
      tokenIn: parsed?.args._tokenIn,
      tokenOut: parsed?.args._tokenOut,
      inAmount: parsed?.args.inAmount.toString(),
      outAmount: parsed?.args.outAmount.toString(),
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
      timestamp: blockTimestampMap[log.blockNumber]
    };
  });

  // Sort by timestamp (descending)
  parsedEvents.sort((a, b) => a.timestamp - b.timestamp);
  return parsedEvents;
}

// Function to generate token price timeline
function generateTokenPriceTimeline(events, woxToken) {
  console.log(`Generating price timeline using ${events.length} events and WOX token ${woxToken}`);
  
  const priceMap = {};

  for (const event of events) {
    const { tokenIn, tokenOut, inAmount, outAmount, timestamp } = event;

    const inAmt = Number(inAmount);
    const outAmt = Number(outAmount);

    // Skip invalid data
    if (inAmt === 0 || outAmt === 0) continue;

    let token;
    let price;

    if (tokenIn.toLowerCase() === woxToken.toLowerCase()) {
      // Swapping WOX to token → price = inAmount / outAmount
      token = tokenOut.toLowerCase();
      price = inAmt / outAmt;
      console.log(`WOX to token swap: ${inAmt} WOX for ${outAmt} ${token}, price = ${price}`);
    } else if (tokenOut.toLowerCase() === woxToken.toLowerCase()) {
      // Swapping token to WOX → price = outAmount / inAmount
      token = tokenIn.toLowerCase();
      price = outAmt / inAmt;
      console.log(`Token to WOX swap: ${inAmt} ${token} for ${outAmt} WOX, price = ${price}`);
    } else {
      // Neither token is WOX — ignore
      console.log(`Ignoring swap between ${tokenIn} and ${tokenOut} (neither is WOX)`);
      continue;
    }

    if (!priceMap[token]) {
      priceMap[token] = [];
    }

    priceMap[token].push({ 
      time: timestamp, 
      price,
      timeFormatted: moment.unix(timestamp).toISOString()
    });
  }

  // Count how many tokens and price points we found
  let totalPricePoints = 0;
  Object.keys(priceMap).forEach(token => {
    totalPricePoints += priceMap[token].length;
    // Sort price points by time (newest first)
    priceMap[token].sort((a, b) => a.time - b.time);
  });
  
  console.log(`Generated price data for ${Object.keys(priceMap).length} tokens with ${totalPricePoints} total price points`);
  
  return priceMap;
}

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

// Main endpoint that combines both functions
app.get('/token-graphs', async (req, res) => {
  try {
    // Get parameters from query string
    const universalContractAddress = req.query.universalContract || '0xd95CA891eCfF265ACf2177651965a85d3B9F9a96';
    const woxAddress = req.query.woxAddress || '0xb9A219631Aed55eBC3D998f17C3840B7eC39C0cc';
    
    // Validate addresses
    if (!ethers.isAddress(universalContractAddress)) {
      return res.status(400).json({ error: 'Invalid universal contract address' });
    }
    
    if (!ethers.isAddress(woxAddress)) {
      return res.status(400).json({ error: 'Invalid WOX token address' });
    }
    
    console.log(`Processing request for universal contract: ${universalContractAddress}, WOX token: ${woxAddress}`);
    
    // Step 1: Get all swap events from the universal contract
    const swapEvents = await getAllUniversalSwapEvents(universalContractAddress);
    
    // Step 2: Generate price timeline for all tokens using the WOX token as reference
    const tokenPrices = generateTokenPriceTimeline(swapEvents, woxAddress);
    
    // Step 3: Format the response
    const result = {
    //   universalContract: universalContractAddress,
    //   woxToken: woxAddress,
    //   eventCount: swapEvents.length,
    //   tokenCount: Object.keys(tokenPrices).length,
      // Include the most recent price for each token
    //   latestPrices: Object.entries(tokenPrices).reduce((acc, [token, pricePoints]) => {
    //     if (pricePoints.length > 0) {
    //       acc[token] = {
    //         price: pricePoints[0].price,
    //         time: pricePoints[0].time,
    //         timeFormatted: pricePoints[0].timeFormatted
    //       };
    //     }
    //     return acc;
    //   }, {}),
      // Include full price history
      priceHistory: tokenPrices
    };
    
    return res.json(result);
  } catch (error) {
    console.error('Error processing request:', error);
    return res.status(500).json({
      error: 'Failed to process request',
      details: error.message,
      stack: error.stack
    });
  }
});

// Add a test endpoint to check if the contract exists and has code
app.get('/check-contract/:address', async (req, res) => {
  try {
    const address = req.params.address;
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    
    const provider = getProvider();
    const code = await provider.getCode(address);
    const blockNumber = await provider.getBlockNumber();
    
    return res.json({
      address,
      hasCode: code !== '0x',
      codeLength: code.length,
      currentBlockNumber: blockNumber
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to check contract',
      details: error.message
    });
  }
});

// Token transactions endpoint from the other script
app.post('/token-transactions', async (req, res) => {
  const { tokenAddresses, userAddress } = req.body;

  // Print log in red color
  console.log('\x1b[31m%s\x1b[0m', 'Received request for token transactions:', { tokenAddresses, userAddress });
  
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
      const creationBlock = await getTokenCreationBlockWeb3(tokenAddress) || 0;
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
        getLogsInChunksWeb3(sentFilter),
        getLogsInChunksWeb3(receivedFilter)
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
    
    // Limit to latest 20 transactions
    const latestTransactions = allTransactions.slice(0, 20);

    console.log(`🔢 AFTER: ${latestTransactions.length} transactions`);
    console.log(`✅ Limit working: ${latestTransactions.length <= 20 ? 'YES' : 'NO'}`);


  return res.json({
    userAddress: normalizedUserAddress,
    tokenCount: validTokenAddresses.length,
    transactionCount: latestTransactions.length,
    totalTransactionsFound: allTransactions.length, // Show total found
    transactions: latestTransactions // Return only latest 20
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
  console.log(`Available endpoints:`);
  console.log(`  GET /token-graphs`);
  console.log(`  GET /check-contract/:address`);
  console.log(`  POST /token-transactions`);
  console.log(`Example: http://localhost:${port}/token-graphs?universalContract=0xd95CA891eCfF265ACf2177651965a85d3B9F9a96&woxAddress=0xb9A219631Aed55eBC3D998f17C3840B7eC39C0cc`);
});
