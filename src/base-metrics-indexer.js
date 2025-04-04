const { ethers } = require('ethers');
const {
  UiPoolDataProvider,
  UiIncentiveDataProvider,
  ChainId,
} = require('@aave/contract-helpers');
const { formatReservesAndIncentives } = require('@aave/math-utils');
const markets = require('@bgd-labs/aave-address-book');
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');
const { initializeDatabase, storeMetrics } = require('./db-storage');

// Configure Base RPC URL
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/d40IDFW5NaYldNIOSb_vuJBNF5sm1WR7';

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Create blocks directory for continuous monitoring
const blocksDir = path.join(dataDir, 'blocks');
if (!fs.existsSync(blocksDir)) {
  fs.mkdirSync(blocksDir, { recursive: true });
}

// Base network configuration
// Base is EVM compatible with chain ID 8453
const BASE_CHAIN_ID = 8453;

// Check if Base is supported in the aave-address-book
let baseAddresses;
try {
  baseAddresses = markets.AaveV3Base;
  console.log('Using Base addresses from aave-address-book');
} catch (error) {
  console.log('Base addresses not found in aave-address-book, using hardcoded addresses');
}

// Base network AAVE contract addresses
const BASE_AAVE_ADDRESSES = baseAddresses || {
  // Using Aave V3 Base addresses
  // These are the correct contract addresses for Base network AAVE
  POOL_ADDRESSES_PROVIDER: '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D', // Pool Addresses Provider
  UI_POOL_DATA_PROVIDER: '0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac', // UI Pool Data Provider
  UI_INCENTIVE_DATA_PROVIDER: '0x9842E5B7b7C6cEDfB1952a388e050582Ff95645b', // UI Incentive Data Provider
  POOL: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5'
};

async function fetchReservesList() {
  console.log('Fetching AAVE reserves list from Base blockchain...');
  
  // Initialize ethers provider
  const provider = new ethers.providers.JsonRpcProvider(BASE_RPC_URL);
  
  // Create interface for Pool Addresses Provider
  const poolAddressesProviderInterface = new ethers.utils.Interface([
    'function getPool() view returns (address)'
  ]);
  
  // Create instance of Pool Addresses Provider contract
  const poolAddressesProvider = new ethers.Contract(
    BASE_AAVE_ADDRESSES.POOL_ADDRESSES_PROVIDER,
    poolAddressesProviderInterface,
    provider
  );
  
  try {
    // Get pool address
    const poolAddress = await poolAddressesProvider.getPool();
    console.log(`AAVE Pool address: ${poolAddress}`);
    
    // Create interface for Pool contract
    const poolInterface = new ethers.utils.Interface([
      'function getReservesList() view returns (address[])'
    ]);
    
    // Create instance of Pool contract
    const pool = new ethers.Contract(
      poolAddress,
      poolInterface,
      provider
    );
    
    // Get reserves list
    const reservesList = await pool.getReservesList();
    console.log(`Found ${reservesList.length} reserves on Base blockchain`);
    return reservesList;
  } catch (error) {
    console.error('Error fetching reserves list:', error);
    throw error;
  }
}

async function indexBaseAaveMetrics(blockNumber = null, storeInDb = false) {
  console.log('Initializing Base AAVE metrics indexer...');
  
  // Initialize ethers provider
  const provider = new ethers.providers.JsonRpcProvider(BASE_RPC_URL);
  
  try {
    // Get current block or use provided block number
    const currentBlock = blockNumber || await provider.getBlockNumber();
    console.log(`Processing Base blockchain block: ${currentBlock}`);
    
    // For diagnostic purposes, fetch the reserves list directly
    await fetchReservesList();
    
    // Initialize Aave data provider contracts
    const poolDataProviderContract = new UiPoolDataProvider({
      uiPoolDataProviderAddress: BASE_AAVE_ADDRESSES.UI_POOL_DATA_PROVIDER,
      provider,
      chainId: BASE_CHAIN_ID,
    });

    const incentiveDataProviderContract = new UiIncentiveDataProvider({
      uiIncentiveDataProviderAddress: BASE_AAVE_ADDRESSES.UI_INCENTIVE_DATA_PROVIDER,
      provider,
      chainId: BASE_CHAIN_ID,
    });

    // Fetch reserves data - use specific block if provided
    const blockTag = blockNumber ? { blockTag: blockNumber } : undefined;
    
    const reserves = await poolDataProviderContract.getReservesHumanized({
      lendingPoolAddressProvider: BASE_AAVE_ADDRESSES.POOL_ADDRESSES_PROVIDER,
    }, blockTag);

    // Fetch incentives data - use specific block if provided
    const reserveIncentives = await incentiveDataProviderContract.getReservesIncentivesDataHumanized({
      lendingPoolAddressProvider: BASE_AAVE_ADDRESSES.POOL_ADDRESSES_PROVIDER,
    }, blockTag);

    const currentTimestamp = dayjs().unix();
    
    // Format reserves data with incentives
    const formattedReserves = formatReservesAndIncentives({
      reserves: reserves.reservesData,
      currentTimestamp,
      marketReferenceCurrencyDecimals: reserves.baseCurrencyData.marketReferenceCurrencyDecimals,
      marketReferencePriceInUsd: reserves.baseCurrencyData.marketReferenceCurrencyPriceInUsd,
      reserveIncentives,
    });

    // Extract metrics for each token
    const metricsPerToken = formattedReserves.map(reserve => {
      // Convert price from wei to normal value (divide by 10^16)
      const priceInUSD = (reserve.priceInMarketReferenceCurrency * 
        reserves.baseCurrencyData.marketReferenceCurrencyPriceInUsd) / 1e16;
      
      // Calculate liquidity (Supplied - Borrowed)
      const totalSupplied = parseFloat(reserve.totalLiquidity);
      const totalBorrowed = parseFloat(reserve.totalDebt);
      const liquidity = totalSupplied - totalBorrowed;
      
      // Calculate USD values
      const liquidityUSD = liquidity * priceInUSD;
      const totalSuppliedUSD = totalSupplied * priceInUSD;
      const totalBorrowedUSD = totalBorrowed * priceInUSD;
      
      // Calculate utilization rate
      const utilizationRate = totalSupplied > 0 
        ? (totalBorrowed / totalSupplied) * 100 
        : 0;
      
      // Log the values with correct price
      console.log(`\n${reserve.name} (${reserve.symbol}) - CONVERTED VALUES:`);
      console.log(`Price (converted from wei): $${priceInUSD.toFixed(6)}`);
      console.log(`Total Supplied (in USD): $${formatNumber(totalSuppliedUSD)}`);
      console.log(`Total Borrowed (in USD): $${formatNumber(totalBorrowedUSD)}`);
      console.log(`Liquidity (in USD): $${formatNumber(liquidityUSD)}`);
      
      return {
        token: reserve.name,
        symbol: reserve.symbol,
        // 1. Price on that block (converted from wei)
        priceInUSD,
        // 2. Liquidity (Supplied - Borrowed)
        liquidity,
        liquidityUSD,
        totalSupplied,
        totalSuppliedUSD,
        totalBorrowed,
        totalBorrowedUSD,
        // 3. Utilization rate
        utilizationRate,
        // 4. Reserves
        reserves: parseFloat(reserve.reserves),
        // 5. Reserve factor
        reserveFactor: parseFloat(reserve.reserveFactor) * 100,
        // 6. Liquidation threshold
        liquidationThreshold: parseFloat(reserve.formattedReserveLiquidationThreshold),
        // 7. Borrow Enabled
        borrowEnabled: reserve.borrowingEnabled,
        // 8. Supply Cap
        supplyCap: parseFloat(reserve.supplyCap),
        // 9. Borrow Cap
        borrowCap: parseFloat(reserve.borrowCap),
        // Additional useful metrics
        supplyAPY: parseFloat(reserve.supplyAPY) * 100,
        variableBorrowAPY: parseFloat(reserve.variableBorrowAPY) * 100,
        stableBorrowAPY: parseFloat(reserve.stableBorrowAPY) * 100,
      };
    });

    // Calculate market totals
    const totalMarketSize = calculateTotalMarketSize(formattedReserves);
    const totalAvailable = calculateTotalAvailable(formattedReserves);
    const totalBorrows = calculateTotalBorrows(formattedReserves);
    const averageUtilization = calculateAverageUtilization(formattedReserves);

    // Print market summary
    console.log('\n======== BASE AAVE METRICS INDEXER ========');
    console.log(`Block: ${currentBlock}`);
    console.log(`Total Market Size: ${formatUSD(totalMarketSize)}`);
    console.log(`Total Available: ${formatUSD(totalAvailable)}`);
    console.log(`Total Borrows: ${formatUSD(totalBorrows)}`);
    console.log(`Average Utilization: ${averageUtilization.toFixed(2)}%`);
    console.log(`Number of Tokens: ${metricsPerToken.length}`);
    console.log('===========================================');
    
    // Print metrics for each token
    metricsPerToken.forEach(tokenMetrics => {
      console.log(`\n--- ${tokenMetrics.token} (${tokenMetrics.symbol}) ---`);
      console.log(`Price: ${formatUSD(tokenMetrics.priceInUSD)}`);
      console.log(`Liquidity (Supplied - Borrowed): ${formatUSD(tokenMetrics.liquidityUSD)}`);
      console.log(`Total Supplied: ${formatUSD(tokenMetrics.totalSuppliedUSD)}`);
      console.log(`Total Borrowed: ${formatUSD(tokenMetrics.totalBorrowedUSD)}`);
      console.log(`Utilization Rate: ${tokenMetrics.utilizationRate.toFixed(2)}%`);
      console.log(`Reserves: ${formatUSD(tokenMetrics.reserves)}`);
      console.log(`Reserve Factor: ${tokenMetrics.reserveFactor.toFixed(2)}%`);
      console.log(`Liquidation Threshold: ${tokenMetrics.liquidationThreshold.toFixed(2)}%`);
      console.log(`Borrow Enabled: ${tokenMetrics.borrowEnabled}`);
      console.log(`Supply Cap: ${tokenMetrics.supplyCap === Infinity ? 'Unlimited' : tokenMetrics.supplyCap.toLocaleString()}`);
      console.log(`Borrow Cap: ${tokenMetrics.borrowCap === Infinity ? 'Unlimited' : tokenMetrics.borrowCap.toLocaleString()}`);
      console.log(`Supply APY: ${tokenMetrics.supplyAPY.toFixed(2)}%`);
      console.log(`Variable Borrow APY: ${tokenMetrics.variableBorrowAPY.toFixed(2)}%`);
      console.log(`Stable Borrow APY: ${tokenMetrics.stableBorrowAPY.toFixed(2)}%`);
    });

    // Prepare metrics data
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = path.join(dataDir, `base-aave-metrics-${timestamp}.json`);
    
    const metricsData = {
      network: 'Base',
      chainId: BASE_CHAIN_ID,
      blockNumber: currentBlock,
      timestamp: currentTimestamp,
      date: new Date(currentTimestamp * 1000).toISOString(),
      totalMarketSize,
      totalAvailable,
      totalBorrows,
      averageUtilization,
      tokenCount: metricsPerToken.length,
      tokenMetrics: metricsPerToken
    };
    
    // Save metrics to file
    fs.writeFileSync(
      filename, 
      JSON.stringify(metricsData, null, 2),
      'utf8'
    );
    
    console.log(`\nMetrics saved to ${filename}`);
    
    // Also save to a latest file
    const latestFile = path.join(dataDir, 'base-aave-metrics-latest.json');
    fs.writeFileSync(
      latestFile,
      JSON.stringify(metricsData, null, 2),
      'utf8'
    );
    
    console.log(`Latest metrics saved to ${latestFile}`);
    
    // If processing a specific block, also save to blocks directory
    if (blockNumber) {
      const blockFile = path.join(blocksDir, `base-block-${blockNumber}.json`);
      fs.writeFileSync(
        blockFile,
        JSON.stringify(metricsData, null, 2),
        'utf8'
      );
      
      // Also update latest block file
      const latestBlockFile = path.join(blocksDir, 'base-latest-block.json');
      fs.writeFileSync(
        latestBlockFile,
        JSON.stringify(metricsData, null, 2),
        'utf8'
      );
    }
    
    // Store in database if requested
    if (storeInDb) {
      await storeMetrics(metricsData);
      console.log(`Metrics for block ${currentBlock} stored in database`);
    }
    
    return metricsData;
    
  } catch (error) {
    console.error('Error indexing Base AAVE metrics:', error);
    throw error;
  }
}

/**
 * Starts continuous block monitoring for Base AAVE metrics
 */
async function startContinuousIndexing() {
  console.log('Starting continuous Base AAVE metrics indexing...');
  
  try {
    // Initialize database schema first
    await initializeDatabase();
    console.log('Database schema initialized');
    
    // Initialize ethers provider
    const provider = new ethers.providers.JsonRpcProvider(BASE_RPC_URL);
    
    // Get current block as starting point
    const currentBlock = await provider.getBlockNumber();
    console.log(`Starting from block ${currentBlock}...`);
    
    let lastProcessedBlock = currentBlock;
    
    // Set up polling interval (2 seconds as requested)
    const POLLING_INTERVAL = 2000;
    
    // Start polling for new blocks
    const intervalId = setInterval(async () => {
      try {
        const blockNumber = await provider.getBlockNumber();
        
        // Process only new blocks
        if (blockNumber <= lastProcessedBlock) {
          return;
        }
        
        console.log(`\n==== New block detected: ${blockNumber} ====`);
        
        // Small delay to ensure the block is fully propagated
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Fetch metrics for this block and store in database
        await indexBaseAaveMetrics(blockNumber, true);
        
        // Update processed block
        lastProcessedBlock = blockNumber;
        
      } catch (error) {
        console.error(`Error processing block:`, error);
      }
    }, POLLING_INTERVAL);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      clearInterval(intervalId);
      console.log('Continuous indexing stopped');
      process.exit(0);
    });
    
    console.log(`Continuous indexing started. Polling every ${POLLING_INTERVAL/1000} seconds. Press Ctrl+C to stop.`);
  } catch (error) {
    console.error('Failed to start continuous indexing:', error);
    throw error;
  }
}

// Helper functions
function calculateTotalMarketSize(formattedReserves) {
  return formattedReserves.reduce((total, reserve) => {
    return total + parseFloat(reserve.totalLiquidityUSD);
  }, 0);
}

function calculateTotalAvailable(formattedReserves) {
  return calculateTotalMarketSize(formattedReserves) - calculateTotalBorrows(formattedReserves);
}

function calculateTotalBorrows(formattedReserves) {
  return formattedReserves.reduce((total, reserve) => {
    return total + parseFloat(reserve.totalDebtUSD);
  }, 0);
}

function calculateAverageUtilization(formattedReserves) {
  const totalSupplied = formattedReserves.reduce((total, reserve) => {
    return total + parseFloat(reserve.totalLiquidityUSD);
  }, 0);
  
  const totalBorrowed = formattedReserves.reduce((total, reserve) => {
    return total + parseFloat(reserve.totalDebtUSD);
  }, 0);
  
  return totalSupplied > 0 ? (totalBorrowed / totalSupplied) * 100 : 0;
}

function formatUSD(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatNumber(num) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(num);
}

// Execute the indexer if this script is run directly
if (require.main === module) {
  // Check if "--continuous" flag is provided
  const args = process.argv.slice(2);
  const isContinuous = args.includes('--continuous');
  
  if (isContinuous) {
    // Start continuous indexing mode
    startContinuousIndexing()
      .catch(err => {
        console.error('Continuous indexing failed to start:', err);
        process.exit(1);
      });
  } else {
    // Run indexer once (default behavior)
    indexBaseAaveMetrics(null, false)
      .then(() => {
        console.log('Base AAVE indexing completed successfully');
      })
      .catch(err => {
        console.error('Base AAVE indexing failed:', err);
        process.exit(1);
      });
  }
}

module.exports = { indexBaseAaveMetrics, startContinuousIndexing };