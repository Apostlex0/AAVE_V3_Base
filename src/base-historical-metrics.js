const { ethers } = require('ethers');
const { UiPoolDataProvider, UiIncentiveDataProvider } = require('@aave/contract-helpers');
const { formatReservesAndIncentives } = require('@aave/math-utils');
const markets = require('@bgd-labs/aave-address-book');
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');

// Configure Base RPC URL
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/d40IDFW5NaYldNIOSb_vuJBNF5sm1WR7';

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Base network configuration
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
  POOL_ADDRESSES_PROVIDER: '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D',
  UI_POOL_DATA_PROVIDER: '0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac',
  UI_INCENTIVE_DATA_PROVIDER: '0x9842E5B7b7C6cEDfB1952a388e050582Ff95645b',
  POOL: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5'
};

/**
 * Fetches AAVE metrics for a specific block number on Base blockchain
 * @param {number} blockNumber - The Base blockchain block number to fetch data for
 * @returns {Promise<Object>} - Object containing the metrics data
 */
async function fetchBaseMetricsAtBlock(blockNumber) {
  console.log(`Fetching Base AAVE metrics for block ${blockNumber}...`);
  
  // Initialize ethers provider with specific block
  const provider = new ethers.providers.JsonRpcProvider(BASE_RPC_URL);
  
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

  try {
    // Get block info
    const block = await provider.getBlock(blockNumber);
    if (!block) {
      throw new Error(`Block ${blockNumber} not found on Base blockchain`);
    }
    
    // Fetch reserves data at specified block
    const reserves = await poolDataProviderContract.getReservesHumanized({
      lendingPoolAddressProvider: BASE_AAVE_ADDRESSES.POOL_ADDRESSES_PROVIDER,
    }, { blockTag: blockNumber });

    // Fetch incentives data at specified block
    const reserveIncentives = await incentiveDataProviderContract.getReservesIncentivesDataHumanized({
      lendingPoolAddressProvider: BASE_AAVE_ADDRESSES.POOL_ADDRESSES_PROVIDER,
    }, { blockTag: blockNumber });

    // Format reserves data with incentives
    const formattedReserves = formatReservesAndIncentives({
      reserves: reserves.reservesData,
      currentTimestamp: block.timestamp,
      marketReferenceCurrencyDecimals: reserves.baseCurrencyData.marketReferenceCurrencyDecimals,
      marketReferencePriceInUsd: reserves.baseCurrencyData.marketReferenceCurrencyPriceInUsd,
      reserveIncentives,
    });

    // Extract metrics for each token
    const metricsPerToken = formattedReserves.map(reserve => {
      // Convert price from wei to normal value (divide by 10^18)
      const priceInUSD = (reserve.priceInMarketReferenceCurrency * 
        reserves.baseCurrencyData.marketReferenceCurrencyPriceInUsd) / 1e18;
      
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

    return {
      network: 'Base',
      chainId: BASE_CHAIN_ID,
      blockNumber,
      timestamp: block.timestamp,
      date: new Date(block.timestamp * 1000).toISOString(),
      totalMarketSize: calculateTotalMarketSize(formattedReserves),
      totalAvailable: calculateTotalAvailable(formattedReserves),
      totalBorrows: calculateTotalBorrows(formattedReserves),
      averageUtilization: calculateAverageUtilization(formattedReserves),
      tokenCount: metricsPerToken.length,
      tokenMetrics: metricsPerToken
    };
    
  } catch (error) {
    console.error(`Error fetching Base metrics for block ${blockNumber}:`, error);
    throw error;
  }
}

/**
 * Compare metrics between two blocks on Base blockchain
 * @param {number} startBlock - Starting block number
 * @param {number} endBlock - Ending block number
 */
async function compareBaseBlockMetrics(startBlock, endBlock) {
  try {
    const startMetrics = await fetchBaseMetricsAtBlock(startBlock);
    const endMetrics = await fetchBaseMetricsAtBlock(endBlock);
    
    console.log(`\n===== BASE AAVE METRICS COMPARISON =====`);
    console.log(`From block ${startBlock} (${startMetrics.date})`);
    console.log(`To block ${endBlock} (${endMetrics.date})`);
    console.log(`Time difference: ${formatTimeDifference(endMetrics.timestamp - startMetrics.timestamp)}`);
    
    // Compare market totals
    const marketSizeChange = calculatePercentChange(startMetrics.totalMarketSize, endMetrics.totalMarketSize);
    const totalBorrowsChange = calculatePercentChange(startMetrics.totalBorrows, endMetrics.totalBorrows);
    
    console.log(`\n--- MARKET OVERVIEW ---`);
    console.log(`Total Market Size: ${formatUSD(startMetrics.totalMarketSize)} → ${formatUSD(endMetrics.totalMarketSize)} (${formatPercentage(marketSizeChange)})`);
    console.log(`Total Borrows: ${formatUSD(startMetrics.totalBorrows)} → ${formatUSD(endMetrics.totalBorrows)} (${formatPercentage(totalBorrowsChange)})`);
    
    // Compare individual tokens
    console.log(`\n--- TOKEN METRICS CHANGES ---`);
    
    // Create a map of all tokens from both blocks
    const allTokens = new Set([
      ...startMetrics.tokenMetrics.map(t => t.symbol),
      ...endMetrics.tokenMetrics.map(t => t.symbol)
    ]);
    
    allTokens.forEach(symbol => {
      const startToken = startMetrics.tokenMetrics.find(t => t.symbol === symbol);
      const endToken = endMetrics.tokenMetrics.find(t => t.symbol === symbol);
      
      if (startToken && endToken) {
        // Token exists in both blocks - compare metrics
        console.log(`\n${startToken.token} (${symbol}):`);
        
        // Price change
        const priceChange = calculatePercentChange(startToken.priceInUSD, endToken.priceInUSD);
        console.log(`  Price: ${formatUSD(startToken.priceInUSD)} → ${formatUSD(endToken.priceInUSD)} (${formatPercentage(priceChange)})`);
        
        // Liquidity change
        const liquidityChange = calculatePercentChange(startToken.liquidity, endToken.liquidity);
        console.log(`  Liquidity: ${formatUSD(startToken.liquidity)} → ${formatUSD(endToken.liquidity)} (${formatPercentage(liquidityChange)})`);
        
        // Utilization change
        const utilizationChange = endToken.utilizationRate - startToken.utilizationRate;
        console.log(`  Utilization: ${startToken.utilizationRate.toFixed(2)}% → ${endToken.utilizationRate.toFixed(2)}% (${formatPercentagePoints(utilizationChange)})`);
        
        // Only show changes in protocol parameters if they changed
        if (startToken.reserveFactor !== endToken.reserveFactor) {
          console.log(`  Reserve Factor: ${startToken.reserveFactor.toFixed(2)}% → ${endToken.reserveFactor.toFixed(2)}%`);
        }
        
        if (startToken.liquidationThreshold !== endToken.liquidationThreshold) {
          console.log(`  Liquidation Threshold: ${startToken.liquidationThreshold.toFixed(2)}% → ${endToken.liquidationThreshold.toFixed(2)}%`);
        }
        
        if (startToken.borrowEnabled !== endToken.borrowEnabled) {
          console.log(`  Borrow Enabled: ${startToken.borrowEnabled} → ${endToken.borrowEnabled}`);
        }
        
        if (startToken.supplyCap !== endToken.supplyCap) {
          console.log(`  Supply Cap: ${formatCap(startToken.supplyCap)} → ${formatCap(endToken.supplyCap)}`);
        }
        
        if (startToken.borrowCap !== endToken.borrowCap) {
          console.log(`  Borrow Cap: ${formatCap(startToken.borrowCap)} → ${formatCap(endToken.borrowCap)}`);
        }
        
        // Interest rates changes
        const supplyAPYChange = endToken.supplyAPY - startToken.supplyAPY;
        const varBorrowAPYChange = endToken.variableBorrowAPY - startToken.variableBorrowAPY;
        
        console.log(`  Supply APY: ${startToken.supplyAPY.toFixed(2)}% → ${endToken.supplyAPY.toFixed(2)}% (${formatPercentagePoints(supplyAPYChange)})`);
        console.log(`  Variable Borrow APY: ${startToken.variableBorrowAPY.toFixed(2)}% → ${endToken.variableBorrowAPY.toFixed(2)}% (${formatPercentagePoints(varBorrowAPYChange)})`);
        
      } else if (startToken && !endToken) {
        // Token removed
        console.log(`\n${startToken.token} (${symbol}): REMOVED from market`);
      } else if (!startToken && endToken) {
        // New token added
        console.log(`\n${endToken.token} (${symbol}): ADDED to market`);
        console.log(`  Price: ${formatUSD(endToken.priceInUSD)}`);
        console.log(`  Liquidity: ${formatUSD(endToken.liquidity)}`);
        console.log(`  Utilization: ${endToken.utilizationRate.toFixed(2)}%`);
      }
    });
    
    // Save comparison to file
    const comparisonData = {
      network: 'Base',
      chainId: BASE_CHAIN_ID,
      startBlock: startMetrics,
      endBlock: endMetrics,
      timeDifferenceSeconds: endMetrics.timestamp - startMetrics.timestamp,
      marketChanges: {
        totalMarketSizeChange: marketSizeChange,
        totalBorrowsChange: totalBorrowsChange
      }
    };
    
    const filename = path.join(dataDir, `base-comparison-${startBlock}-${endBlock}.json`);
    fs.writeFileSync(
      filename, 
      JSON.stringify(comparisonData, null, 2),
      'utf8'
    );
    
    console.log(`\nComparison data saved to ${filename}`);
    
  } catch (error) {
    console.error('Error comparing Base block metrics:', error);
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

function calculatePercentChange(start, end) {
  if (start === 0) return end === 0 ? 0 : 100;
  return ((end - start) / Math.abs(start)) * 100;
}

function formatUSD(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatPercentage(value) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatPercentagePoints(value) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)} percentage points`;
}

function formatCap(value) {
  return value === Infinity ? 'Unlimited' : value.toLocaleString();
}

function formatTimeDifference(secondsDiff) {
  const days = Math.floor(secondsDiff / 86400);
  const hours = Math.floor((secondsDiff % 86400) / 3600);
  const minutes = Math.floor((secondsDiff % 3600) / 60);
  
  let result = '';
  if (days > 0) result += `${days} days `;
  if (hours > 0) result += `${hours} hours `;
  if (minutes > 0) result += `${minutes} minutes`;
  
  return result.trim();
}

// If this script is run directly, use the provided blocks or fetch the latest
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 2) {
    // Compare blocks provided via command line
    const startBlock = parseInt(args[0]);
    const endBlock = parseInt(args[1]);
    
    if (isNaN(startBlock) || isNaN(endBlock)) {
      console.error('Please provide valid block numbers');
      process.exit(1);
    }
    
    compareBaseBlockMetrics(startBlock, endBlock);
  } else if (args.length === 1) {
    // Fetch a single block
    const blockNumber = parseInt(args[0]);
    
    if (isNaN(blockNumber)) {
      console.error('Please provide a valid block number');
      process.exit(1);
    }
    
    fetchBaseMetricsAtBlock(blockNumber)
      .then(metrics => {
        console.log(`\nBase AAVE metrics for block ${blockNumber}:`);
        console.log(`Date: ${metrics.date}`);
        console.log(`Total Market Size: ${formatUSD(metrics.totalMarketSize)}`);
        console.log(`Total Available: ${formatUSD(metrics.totalAvailable)}`);
        console.log(`Total Borrows: ${formatUSD(metrics.totalBorrows)}`);
        
        // Save to file
        const filename = path.join(dataDir, `base-block-${blockNumber}.json`);
        fs.writeFileSync(
          filename, 
          JSON.stringify(metrics, null, 2),
          'utf8'
        );
        
        console.log(`\nMetrics saved to ${filename}`);
      })
      .catch(err => {
        console.error('Failed to fetch metrics:', err);
        process.exit(1);
      });
  } else {
    // Help text if no arguments provided
    console.log('Usage:');
    console.log('  node base-historical-metrics.js <blockNumber>');
    console.log('    Fetches metrics for a specific block');
    console.log('  node base-historical-metrics.js <startBlock> <endBlock>');
    console.log('    Compares metrics between two blocks');
    console.log('\nExample:');
    console.log('  node base-historical-metrics.js 4000000 4100000');
  }
}

module.exports = {
  fetchBaseMetricsAtBlock,
  compareBaseBlockMetrics
};