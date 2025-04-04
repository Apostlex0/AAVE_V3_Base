const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection configuration
const connectionString = 'postgresql://postgres.pmmawkmekmzgqoghnxcv:anshuman1@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';

// Create a connection pool
const pool = new Pool({
  connectionString
});

/**
 * Initialize database schema for AAVE metrics
 * Creates a separate table for each token
 */
async function initializeDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('Initializing database schema...');
    
    // Create main metrics table for overall market data
    await client.query(`
      CREATE TABLE IF NOT EXISTS aave_market_metrics (
        block_number BIGINT PRIMARY KEY,
        timestamp BIGINT NOT NULL,
        network VARCHAR(50) NOT NULL,
        total_market_size NUMERIC(36,18) NOT NULL,
        total_borrows NUMERIC(36,18) NOT NULL,
        average_utilization NUMERIC(10,4) NOT NULL,
        token_count INTEGER NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ aave_market_metrics table created or exists');
    
    // Get the latest metrics file to determine tokens
    const latestFile = path.join(__dirname, '..', 'data', 'base-aave-metrics-latest.json');
    
    let tokenSymbols = [];
    if (fs.existsSync(latestFile)) {
      const metricsData = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
      tokenSymbols = metricsData.tokenMetrics.map(token => token.symbol);
      console.log(`Found ${tokenSymbols.length} tokens in latest metrics file`);
    } else {
      // Default tokens if no metrics file exists yet
      tokenSymbols = ['WETH', 'USDC', 'USDbC', 'wstETH', 'cbETH', 'cbBTC', 'GHO', 'weETH', 'ezETH', 'wrsETH', 'LBTC', 'EURC'];
      console.log(`Using default list of ${tokenSymbols.length} tokens`);
    }
    
    // Create a table for each token
    for (const symbol of tokenSymbols) {
      const tableName = `aave_token_${symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          block_number BIGINT PRIMARY KEY,
          timestamp BIGINT NOT NULL,
          token_name VARCHAR(100) NOT NULL,
          price_usd NUMERIC(36,18) NOT NULL,
          total_supplied NUMERIC(36,18) NOT NULL,
          total_supplied_usd NUMERIC(36,18) NOT NULL,
          total_borrowed NUMERIC(36,18) NOT NULL,
          total_borrowed_usd NUMERIC(36,18) NOT NULL,
          utilization_rate NUMERIC(10,4) NOT NULL,
          supply_apy NUMERIC(10,4) NOT NULL,
          borrow_apy NUMERIC(10,4) NOT NULL,
          reserve_factor NUMERIC(10,4),
          liquidation_threshold NUMERIC(10,4),
          borrow_enabled BOOLEAN,
          supply_cap NUMERIC(36,18),
          borrow_cap NUMERIC(36,18),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      console.log(`✓ ${tableName} table created or exists`);
    }
    
    console.log('✓ All token tables created');
    console.log('Database initialization completed successfully');
    
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Store AAVE metrics data in the database (per-token table approach)
 * @param {Object} metricsData - The metrics data to store
 */
async function storeMetrics(metricsData) {
  const client = await pool.connect();
  
  try {
    // Start transaction
    await client.query('BEGIN');
    
    // Insert main market metrics
    await client.query(`
      INSERT INTO aave_market_metrics 
      (block_number, timestamp, network, total_market_size, total_borrows, average_utilization, token_count) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (block_number) DO UPDATE SET
        timestamp = EXCLUDED.timestamp,
        total_market_size = EXCLUDED.total_market_size,
        total_borrows = EXCLUDED.total_borrows,
        average_utilization = EXCLUDED.average_utilization,
        token_count = EXCLUDED.token_count
    `, [
      metricsData.blockNumber,
      metricsData.timestamp,
      metricsData.network,
      metricsData.totalMarketSize,
      metricsData.totalBorrows,
      metricsData.averageUtilization,
      metricsData.tokenCount
    ]);
    
    console.log(`Stored main market metrics for block ${metricsData.blockNumber}`);
    
    // Insert token-specific metrics into their respective tables
    for (const token of metricsData.tokenMetrics) {
      const tableName = `aave_token_${token.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      
      await client.query(`
        INSERT INTO ${tableName} 
        (block_number, timestamp, token_name, price_usd, 
         total_supplied, total_supplied_usd, 
         total_borrowed, total_borrowed_usd, 
         utilization_rate, supply_apy, borrow_apy,
         reserve_factor, liquidation_threshold, borrow_enabled,
         supply_cap, borrow_cap) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (block_number) DO UPDATE SET
          timestamp = EXCLUDED.timestamp,
          price_usd = EXCLUDED.price_usd,
          total_supplied = EXCLUDED.total_supplied,
          total_supplied_usd = EXCLUDED.total_supplied_usd,
          total_borrowed = EXCLUDED.total_borrowed,
          total_borrowed_usd = EXCLUDED.total_borrowed_usd,
          utilization_rate = EXCLUDED.utilization_rate,
          supply_apy = EXCLUDED.supply_apy,
          borrow_apy = EXCLUDED.borrow_apy,
          reserve_factor = EXCLUDED.reserve_factor,
          liquidation_threshold = EXCLUDED.liquidation_threshold,
          borrow_enabled = EXCLUDED.borrow_enabled,
          supply_cap = EXCLUDED.supply_cap,
          borrow_cap = EXCLUDED.borrow_cap
      `, [
        metricsData.blockNumber,
        metricsData.timestamp,
        token.token,
        token.priceInUSD,
        token.totalSupplied,
        token.totalSuppliedUSD,
        token.totalBorrowed,
        token.totalBorrowedUSD,
        token.utilizationRate,
        token.supplyAPY,
        token.variableBorrowAPY,
        token.reserveFactor,
        token.liquidationThreshold,
        token.borrowEnabled,
        token.supplyCap === Infinity ? null : token.supplyCap,
        token.borrowCap === Infinity ? null : token.borrowCap
      ]);
      
      console.log(`Stored metrics for ${token.symbol} in block ${metricsData.blockNumber}`);
    }
    
    // Commit transaction
    await client.query('COMMIT');
    
    console.log(`Successfully stored all metrics for block ${metricsData.blockNumber}`);
    
  } catch (error) {
    // Rollback transaction on error
    await client.query('ROLLBACK');
    console.error(`Failed to store metrics for block ${metricsData.blockNumber}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Store the latest JSON metrics file in the database
 */
async function storeLatestMetrics() {
  try {
    const latestFile = path.join(__dirname, '..', 'data', 'base-aave-metrics-latest.json');
    
    if (!fs.existsSync(latestFile)) {
      console.error('Latest metrics file not found. Please run the indexer first.');
      return;
    }
    
    const metricsData = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
    await storeMetrics(metricsData);
    
    console.log(`Latest metrics for block ${metricsData.blockNumber} stored in database`);
    
  } catch (error) {
    console.error('Failed to store latest metrics:', error);
    throw error;
  }
}

/**
 * Query and print recent metrics from database
 * @param {Number} limit - Number of blocks to retrieve
 */
async function getRecentMetrics(limit = 5) {
  const client = await pool.connect();
  
  try {
    const metricsQuery = await client.query(`
      SELECT * FROM aave_market_metrics 
      ORDER BY block_number DESC 
      LIMIT $1
    `, [limit]);
    
    console.log(`\n=== Recent Market Metrics (${metricsQuery.rows.length} blocks) ===`);
    console.table(metricsQuery.rows);
    
    // Get token metrics for the most recent block
    if (metricsQuery.rows.length > 0) {
      const latestBlock = metricsQuery.rows[0].block_number;
      
      // Get list of token tables
      const tableQuery = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name LIKE 'aave_token_%'
      `);
      
      console.log(`\n=== Token Metrics for Block ${latestBlock} ===`);
      
      for (const tableRow of tableQuery.rows) {
        const tokenTable = tableRow.table_name;
        const tokenSymbol = tokenTable.replace('aave_token_', '').toUpperCase();
        
        const tokenQuery = await client.query(`
          SELECT * FROM ${tokenTable}
          WHERE block_number = $1
        `, [latestBlock]);
        
        if (tokenQuery.rows.length > 0) {
          const tokenData = tokenQuery.rows[0];
          console.log(`\n${tokenData.token_name} (${tokenSymbol}):`);
          console.log(`Price: $${parseFloat(tokenData.price_usd).toFixed(6)}`);
          console.log(`Total Supplied: $${parseFloat(tokenData.total_supplied_usd).toLocaleString()}`);
          console.log(`Total Borrowed: $${parseFloat(tokenData.total_borrowed_usd).toLocaleString()}`);
          console.log(`Utilization Rate: ${parseFloat(tokenData.utilization_rate).toFixed(2)}%`);
          console.log(`Supply APY: ${parseFloat(tokenData.supply_apy).toFixed(2)}%`);
          console.log(`Borrow APY: ${parseFloat(tokenData.borrow_apy).toFixed(2)}%`);
        }
      }
    }
    
    return metricsQuery.rows;
    
  } catch (error) {
    console.error('Failed to retrieve recent metrics:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close the database connection pool
 */
async function closePool() {
  await pool.end();
  console.log('Database connection pool closed');
}

// Execute the script if run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] || 'test';
  
  (async () => {
    try {
      switch (command) {
        case 'init':
          await initializeDatabase();
          break;
          
        case 'store':
          await initializeDatabase();
          await storeLatestMetrics();
          break;
          
        case 'recent':
          const limit = parseInt(args[1]) || 5;
          await getRecentMetrics(limit);
          break;
          
        case 'test':
        default:
          await initializeDatabase();
          console.log('\nDatabase initialized successfully.');
          console.log('Available commands:');
          console.log('  node src/db-storage.js init    - Initialize database schema');
          console.log('  node src/db-storage.js store   - Store latest metrics in database');
          console.log('  node src/db-storage.js recent [limit] - Show recent metrics');
          break;
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  })();
}

module.exports = {
  initializeDatabase,
  storeMetrics,
  storeLatestMetrics,
  getRecentMetrics,
  closePool
};