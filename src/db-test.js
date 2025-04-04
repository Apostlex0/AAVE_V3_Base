const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection configuration
const connectionString = 'postgresql://postgres.pmmawkmekmzgqoghnxcv:anshuman1@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';

// Create a connection pool
const pool = new Pool({
  connectionString
});

// Directory for saving test results
const resultsDir = path.join(__dirname, '..', 'data', 'db-tests');
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

/**
 * Test database connection and perform basic queries
 */
async function testDatabaseConnection() {
  console.log('Testing PostgreSQL database connection...');
  
  try {
    // Simple connection test
    const client = await pool.connect();
    console.log('✅ Successfully connected to PostgreSQL database');
    
    // Create a test table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS aave_metrics_test (
        id SERIAL PRIMARY KEY,
        block_number BIGINT NOT NULL,
        timestamp BIGINT NOT NULL,
        network VARCHAR(50) NOT NULL,
        total_market_size NUMERIC(36,18) NOT NULL,
        total_borrows NUMERIC(36,18) NOT NULL,
        average_utilization NUMERIC(10,4) NOT NULL,
        token_count INTEGER NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Test table created or already exists');
    
    // Insert test data
    const now = Math.floor(Date.now() / 1000);
    const insertResult = await client.query(`
      INSERT INTO aave_metrics_test 
      (block_number, timestamp, network, total_market_size, total_borrows, average_utilization, token_count) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      28489250, // block number
      now, // timestamp
      'Base', // network
      600000000, // total market size
      270000000, // total borrows
      45.0, // average utilization
      12 // token count
    ]);
    
    const insertedId = insertResult.rows[0].id;
    console.log(`✅ Test record inserted with ID: ${insertedId}`);
    
    // Query test data
    const queryResult = await client.query('SELECT * FROM aave_metrics_test ORDER BY id DESC LIMIT 5');
    console.log('✅ Retrieved recent test records:');
    console.table(queryResult.rows);
    
    // Save test results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = path.join(resultsDir, `db-test-${timestamp}.json`);
    fs.writeFileSync(
      filename,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        connection: 'success',
        testTableName: 'aave_metrics_test',
        insertedId,
        recentRecords: queryResult.rows
      }, null, 2),
      'utf8'
    );
    
    console.log(`\nTest results saved to ${filename}`);
    
    client.release();
    console.log('\nDatabase test completed successfully');
    
  } catch (error) {
    console.error('❌ Database connection test failed:', error);
    
    // Save error information
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = path.join(resultsDir, `db-test-error-${timestamp}.json`);
    fs.writeFileSync(
      filename,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        connection: 'failed',
        error: {
          message: error.message,
          stack: error.stack
        }
      }, null, 2),
      'utf8'
    );
    
    console.log(`\nError details saved to ${filename}`);
  } finally {
    // Close pool
    await pool.end();
  }
}

// Execute if this script is run directly
if (require.main === module) {
  testDatabaseConnection()
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error('Unhandled error in database test:', err);
      process.exit(1);
    });
}

module.exports = { testDatabaseConnection };