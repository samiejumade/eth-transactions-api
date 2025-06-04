// const express = require('express');
// const Web3 = require('web3');
// const moment = require('moment');

// const app = express();
// const port = process.env.PORT || 3000;

// // Connect to your local Hyperledger Besu node
// // Update the URL if your node is running on a different address/port
// const web3 = new Web3('http://localhost:8545');

// app.use(express.json());

// // Endpoint to get transactions for an address
// app.get('/transactions/:address', async (req, res) => {
//   const { address } = req.params;

//   // Validate address format
//   if (!web3.utils.isAddress(address)) {
//     return res.status(400).json({ error: 'Invalid address format' });
//   }

//   try {
//     // Get current block number
//     const currentBlockNumber = await web3.eth.getBlockNumber();
    
//     // We'll scan the last 10000 blocks to find transactions
//     // You can adjust this number based on your needs
//     const blocksToScan = 10000;
//     const startBlock = Math.max(0, currentBlockNumber - blocksToScan);
    
//     console.log(`Scanning from block ${startBlock} to ${currentBlockNumber}`);
    
//     const transactions = [];
    
//     // Scan blocks for transactions involving the address
//     for (let i = currentBlockNumber; i >= startBlock && transactions.length < 20; i--) {
//       const block = await web3.eth.getBlock(i, true);
      
//       if (block && block.transactions) {
//         // Filter transactions involving the address
//         const addressTransactions = block.transactions.filter(tx => 
//           tx.from && tx.from.toLowerCase() === address.toLowerCase() || 
//           tx.to && tx.to.toLowerCase() === address.toLowerCase()
//         );
        
//         // Format and add transactions to our result array
//         for (const tx of addressTransactions) {
//           if (transactions.length >= 20) break;
          
//           // Get transaction receipt for gas used
//           const receipt = await web3.eth.getTransactionReceipt(tx.hash);
          
//           transactions.push({
//             hash: tx.hash,
//             from: tx.from,
//             to: tx.to,
//             value: web3.utils.fromWei(tx.value, 'ether'),
//             gasUsed: receipt ? receipt.gasUsed : 'N/A',
//             timeStamp: moment.unix(block.timestamp).toISOString()
//           });
//         }
//       }
      
//       // Log progress every 100 blocks
//       if (i % 100 === 0) {
//         console.log(`Processed block ${i}, found ${transactions.length} transactions so far`);
//       }
//     }
    
//     return res.json({ 
//       address,
//       transactionCount: transactions.length,
//       transactions
//     });
//   } catch (error) {
//     console.error('Error fetching transactions:', error);
//     return res.status(500).json({ 
//       error: 'Failed to fetch transactions. Please try again later.',
//       details: error.message
//     });
//   }
// });

// // Endpoint to get token transactions for an address
// app.get('/token-transactions/:address', async (req, res) => {
//   const { address } = req.params;
//   const { tokenAddress } = req.query;

//   // Validate addresses
//   if (!web3.utils.isAddress(address)) {
//     return res.status(400).json({ error: 'Invalid address format' });
//   }
  
//   if (tokenAddress && !web3.utils.isAddress(tokenAddress)) {
//     return res.status(400).json({ error: 'Invalid token address format' });
//   }

//   try {
//     // Get current block number
//     const currentBlockNumber = await web3.eth.getBlockNumber();
    
//     // We'll scan the last 10000 blocks to find transactions
//     const blocksToScan = 10000;
//     const startBlock = Math.max(0, currentBlockNumber - blocksToScan);
    
//     console.log(`Scanning from block ${startBlock} to ${currentBlockNumber}`);
    
//     const transactions = [];
    
//     // ERC-20 Transfer event signature
//     const transferEventSignature = web3.utils.sha3('Transfer(address,address,uint256)');
    
//     // Scan blocks for token transfer events
//     for (let i = currentBlockNumber; i >= startBlock && transactions.length < 20; i--) {
//       // Get block with transaction data
//       const block = await web3.eth.getBlock(i, true);
      
//       if (block && block.transactions) {
//         // Process each transaction in the block
//         for (const tx of block.transactions) {
//           if (transactions.length >= 20) break;
          
//           // Get transaction receipt to check for logs
//           const receipt = await web3.eth.getTransactionReceipt(tx.hash);
          
//           if (receipt && receipt.logs) {
//             // Filter logs for Transfer events
//             const transferLogs = receipt.logs.filter(log => 
//               log.topics[0] === transferEventSignature &&
//               (
//                 // Filter for the specific token address if provided
//                 !tokenAddress || log.address.toLowerCase() === tokenAddress.toLowerCase()
//               ) &&
//               (
//                 // Filter for transfers involving our address
//                 (log.topics[1] && '0x' + log.topics[1].slice(26).toLowerCase() === address.toLowerCase()) ||
//                 (log.topics[2] && '0x' + log.topics[2].slice(26).toLowerCase() === address.toLowerCase())
//               )
//             );
            
//             // Process transfer logs
//             for (const log of transferLogs) {
//               if (transactions.length >= 20) break;
              
//               const from = '0x' + log.topics[1].slice(26);
//               const to = '0x' + log.topics[2].slice(26);
//               const value = web3.utils.hexToNumberString(log.data);
              
//               transactions.push({
//                 hash: tx.hash,
//                 tokenAddress: log.address,
//                 from,
//                 to,
//                 value,
//                 gasUsed: receipt.gasUsed,
//                 timeStamp: moment.unix(block.timestamp).toISOString()
//               });
//             }
//           }
//         }
//       }
      
//       // Log progress every 100 blocks
//       if (i % 100 === 0) {
//         console.log(`Processed block ${i}, found ${transactions.length} token transactions so far`);
//       }
//     }
    
//     return res.json({ 
//       address,
//       tokenAddress: tokenAddress || 'all',
//       transactionCount: transactions.length,
//       transactions
//     });
//   } catch (error) {
//     console.error('Error fetching token transactions:', error);
//     return res.status(500).json({ 
//       error: 'Failed to fetch token transactions. Please try again later.',
//       details: error.message
//     });
//   }
// });

// // Start the server
// app.listen(port, () => {
//   console.log(`Server running on port ${port}`);
// });

const { ethers } = require('ethers');

// Helper function to get provider
function getProvider() {
  return new ethers.JsonRpcProvider('http://localhost:8545');
}

// Helper function to get token creation block
async function getTokenCreationBlock(tokenAddress, provider) {
  // This is a simplified approach - in production you might want to use a more efficient method
  // or maintain a database of token creation blocks
  try {
    // Start from a reasonable block in the past or use 0 for a full scan
    return 0; // For simplicity, but this will be inefficient
  } catch (error) {
    console.error(`Error finding creation block for ${tokenAddress}:`, error);
    return 0;
  }
}

// Helper function to get logs in chunks to avoid RPC timeout issues
async function getLogsInChunks(provider, filter) {
  const logs = [];
  const chunkSize = 10000; // Adjust based on your node's capabilities
  
  let fromBlock = filter.fromBlock;
  const toBlock = filter.toBlock;
  
  while (fromBlock <= toBlock) {
    const nextBlock = Math.min(fromBlock + chunkSize, toBlock);
    try {
      const chunkLogs = await provider.getLogs({
        ...filter,
        fromBlock: fromBlock,
        toBlock: nextBlock
      });
      logs.push(...chunkLogs);
    } catch (error) {
      console.error(`Error fetching logs from ${fromBlock} to ${nextBlock}:`, error);
    }
    fromBlock = nextBlock + 1;
  }
  
  return logs;
}

async function getAllTransactions(tokenAddresses, userAddress) {
  const provider = getProvider();
  if (!provider) return [];
  
  // 1. Validate addresses
  if (!ethers.isAddress(userAddress)) throw new Error("Invalid user address");
  const checksumAddress = ethers.getAddress(userAddress);
  
  // 2. Create filter using ERC-20 Transfer event signature
  const iface = new ethers.Interface([
    "event Transfer(address indexed from, address indexed to, uint256 value)"
  ]);
  const transferTopic = iface.getEvent("Transfer")?.topicHash;
  const allLogs = [];
  
  // 3. Batch process tokens using multicall pattern
  for (const token of tokenAddresses) {
    if (!ethers.isAddress(token)) continue;
    
    // 4. Find the token's creation block to limit search range
    const creationBlock = await getTokenCreationBlock(token, provider);
    
    // 5. Smart range calculation with binary search
    let fromBlock = creationBlock;
    let toBlock = await provider.getBlockNumber();
    
    // 6. Get logs using optimized range requests
    const logs = await getLogsInChunks(provider, {
      address: token,
      topics: [
        transferTopic,
        null, // Any from/to address
        null  // Combined with OR filters
      ],
      fromBlock,
      toBlock
    });
    
    allLogs.push(...logs);
  }
  
  // Extract unique block numbers from the logs
  const blockNumbers = [...new Set(allLogs.map(log => log.blockNumber))];
  
  // Fetch block data for each unique block number
  const blockData = await Promise.all(
    blockNumbers.map(async (blockNumber) => {
      const block = await provider.getBlock(blockNumber);
      return { blockNumber, timestamp: block?.timestamp };
    })
  );
  
  // Create a mapping of blockNumber to timestamp
  const blockTimestampMap = blockData.reduce((acc, { blockNumber, timestamp }) => {
    acc[blockNumber] = timestamp;
    return acc;
  }, {});
  
  // Filter and parse logs to include transaction details with timestamps
  let transactions = allLogs
    .filter(log => {
      const parsed = iface.parseLog(log);
      return parsed?.args.from === checksumAddress || parsed?.args.to === checksumAddress;
    })
    .map(log => {
      const parsed = iface.parseLog(log);
      return {
        token: log.address,
        from: parsed?.args.from,
        to: parsed?.args.to,
        value: parsed?.args.value.toString(),
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
        timestamp: blockTimestampMap[log.blockNumber] // Append the timestamp
      };
    });
  
  // Sort transactions by timestamp in descending order
  transactions.sort((a, b) => b.timestamp - a.timestamp);
  
  return transactions;
}

module.exports = {
  getAllTransactions
};
