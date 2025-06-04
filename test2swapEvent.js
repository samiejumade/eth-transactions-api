const express = require('express');
const { ethers } = require('ethers');
const moment = require('moment');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Helper function to get provider
function getProvider() {
  // Make sure this is connecting to the same node as your original code
  return new ethers.JsonRpcProvider('http://localhost:8545');
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

  // Adaptive chunking with retries
  async function getLogsInChunks(
    provider,
    filter,
    maxChunk = 5000
  ) {
    let fromBlock = filter.fromBlock;
    const toBlock = filter.toBlock;
    const logs= [];
  
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


  console.log('data : ',parsedEvents)

  // Sort by timestamp (descending)
  parsedEvents.sort((a, b) => b.timestamp - a.timestamp);
  return parsedEvents;
  
}

getAllUniversalSwapEvents("0xd95CA891eCfF265ACf2177651965a85d3B9F9a96")


// Function to generate token price timeline - keeping as close as possible to the original
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
    priceMap[token].sort((a, b) => b.time - a.time);
  });
  
  console.log(`Generated price data for ${Object.keys(priceMap).length} tokens with ${totalPricePoints} total price points`);
  
  return priceMap;
}


// Main endpoint that combines both functions
app.get('/token-prices', async (req, res) => {
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
      universalContract: universalContractAddress,
      woxToken: woxAddress,
      eventCount: swapEvents.length,
      tokenCount: Object.keys(tokenPrices).length,
      // Include the most recent price for each token
      latestPrices: Object.entries(tokenPrices).reduce((acc, [token, pricePoints]) => {
        if (pricePoints.length > 0) {
          acc[token] = {
            price: pricePoints[0].price,
            time: pricePoints[0].time,
            timeFormatted: pricePoints[0].timeFormatted
          };
        }
        return acc;
      }, {}),
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

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Available endpoints:`);
  console.log(`  GET /token-prices`);
  console.log(`  GET /check-contract/:address`);
  console.log(`Example: http://localhost:${port}/token-prices?universalContract=0xd95CA891eCfF265ACf2177651965a85d3B9F9a96&woxAddress=0xb9A219631Aed55eBC3D998f17C3840B7eC39C0cc`);
});
