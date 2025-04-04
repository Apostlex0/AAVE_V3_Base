const fs = require('fs');
const path = require('path');

// Get the latest Base metrics file
const dataDir = path.join(__dirname, '..', 'data');
const latestFile = path.join(dataDir, 'base-aave-metrics-latest.json');

if (!fs.existsSync(latestFile)) {
  console.error('Latest metrics file not found. Please run the Base indexer first.');
  process.exit(1);
}

// Read the latest metrics
const metricsData = JSON.parse(fs.readFileSync(latestFile, 'utf8'));

// Generate HTML report
function generateHTMLReport(data) {
  const reportDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportFile = path.join(reportDir, `base-aave-report-${timestamp}.html`);
  const latestReportFile = path.join(reportDir, 'base-aave-report-latest.html');

  // Sort tokens by total supplied (descending)
  const sortedTokens = [...data.tokenMetrics].sort((a, b) => b.totalSuppliedUSD - a.totalSuppliedUSD);
  
  // Calculate additional metrics
  const topUtilizationTokens = [...data.tokenMetrics]
    .filter(token => token.totalSupplied > 0)
    .sort((a, b) => b.utilizationRate - a.utilizationRate)
    .slice(0, 5);

  const topSupplyAPYTokens = [...data.tokenMetrics]
    .filter(token => token.totalSupplied > 0)
    .sort((a, b) => b.supplyAPY - a.supplyAPY)
    .slice(0, 5);

  const topBorrowAPYTokens = [...data.tokenMetrics]
    .filter(token => token.borrowEnabled)
    .sort((a, b) => b.variableBorrowAPY - a.variableBorrowAPY)
    .slice(0, 5);

  // Create HTML content
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AAVE Base Market Report</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f9f9f9;
        }
        .header {
            background-color: #2ebac6;
            color: white;
            padding: 20px;
            border-radius: 5px;
            margin-bottom: 20px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
        }
        .timestamp {
            font-size: 14px;
            color: rgba(255,255,255,0.8);
        }
        .stats-container {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background-color: white;
            border-radius: 5px;
            padding: 15px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .stat-title {
            color: #666;
            font-size: 14px;
            margin-bottom: 5px;
        }
        .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #2ebac6;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            background-color: white;
        }
        th, td {
            text-align: left;
            padding: 12px 15px;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #2ebac6;
            color: white;
            font-weight: normal;
        }
        tr:hover {
            background-color: #f5f5f5;
        }
        .section-title {
            margin-top: 30px;
            margin-bottom: 15px;
            color: #333;
            border-bottom: 2px solid #2ebac6;
            padding-bottom: 5px;
        }
        .top-lists {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .top-list {
            background-color: white;
            border-radius: 5px;
            padding: 15px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .top-list h3 {
            color: #2ebac6;
            margin-top: 0;
            border-bottom: 1px solid #eee;
            padding-bottom: 10px;
        }
        .top-list-item {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        .top-list-name {
            font-weight: bold;
        }
        .top-list-value {
            color: #2ebac6;
        }
        .progress-bar-container {
            width: 100%;
            background-color: #eee;
            border-radius: 10px;
            height: 10px;
            margin-top: 20px;
            overflow: hidden;
        }
        .progress-bar {
            height: 100%;
            background-color: #2ebac6;
            border-radius: 10px;
        }
        .footer {
            text-align: center;
            margin-top: 50px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            color: #666;
            font-size: 14px;
        }
        
        /* Utilization rate colors */
        .utilization-low {
            color: #5cb85c;
        }
        .utilization-medium {
            color: #f0ad4e;
        }
        .utilization-high {
            color: #d9534f;
        }
        
        .pill {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: bold;
            color: white;
        }
        .pill-green {
            background-color: #5cb85c;
        }
        .pill-red {
            background-color: #d9534f;
        }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>AAVE Base Market Report</h1>
            <p class="timestamp">Generated on ${new Date(data.timestamp * 1000).toLocaleString()} (Block #${data.blockNumber})</p>
        </div>
        <div>
            <div class="stat-title">Overall Utilization</div>
            <div class="stat-value">${data.averageUtilization.toFixed(2)}%</div>
        </div>
    </div>
    
    <div class="stats-container">
        <div class="stat-card">
            <div class="stat-title">Total Market Size</div>
            <div class="stat-value">$${formatNumber(data.totalMarketSize)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-title">Total Available</div>
            <div class="stat-value">$${formatNumber(data.totalAvailable)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-title">Total Borrows</div>
            <div class="stat-value">$${formatNumber(data.totalBorrows)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-title">Number of Tokens</div>
            <div class="stat-value">${data.tokenCount}</div>
        </div>
    </div>
    
    <div class="progress-bar-container">
        <div class="progress-bar" style="width: ${data.averageUtilization}%"></div>
    </div>
    
    <h2 class="section-title">Top Assets by Market Size</h2>
    
    <table>
        <thead>
            <tr>
                <th>Asset</th>
                <th>Price</th>
                <th>Total Supplied</th>
                <th>Total Borrowed</th>
                <th>Utilization Rate</th>
                <th>Supply APY</th>
                <th>Borrow APY</th>
            </tr>
        </thead>
        <tbody>
            ${sortedTokens.map(token => `
                <tr>
                    <td><strong>${token.token} (${token.symbol})</strong></td>
                    <td>$${typeof token.priceInUSD === 'number' ? token.priceInUSD.toFixed(6) : 'N/A'}</td>
                    <td>$${formatNumber(token.totalSuppliedUSD)}</td>
                    <td>$${formatNumber(token.totalBorrowedUSD)}</td>
                    <td class="${getUtilizationClass(token.utilizationRate)}">${token.utilizationRate.toFixed(2)}%</td>
                    <td>${token.supplyAPY.toFixed(2)}%</td>
                    <td>${token.variableBorrowAPY.toFixed(2)}%</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    
    <h2 class="section-title">Top Lists</h2>
    
    <div class="top-lists">
        <div class="top-list">
            <h3>Top Utilization Rate</h3>
            ${topUtilizationTokens.map(token => `
                <div class="top-list-item">
                    <div class="top-list-name">${token.symbol}</div>
                    <div class="top-list-value">${token.utilizationRate.toFixed(2)}%</div>
                </div>
            `).join('')}
        </div>
        
        <div class="top-list">
            <h3>Best Supply APY</h3>
            ${topSupplyAPYTokens.map(token => `
                <div class="top-list-item">
                    <div class="top-list-name">${token.symbol}</div>
                    <div class="top-list-value">${token.supplyAPY.toFixed(2)}%</div>
                </div>
            `).join('')}
        </div>
        
        <div class="top-list">
            <h3>Highest Borrow APY</h3>
            ${topBorrowAPYTokens.map(token => `
                <div class="top-list-item">
                    <div class="top-list-name">${token.symbol}</div>
                    <div class="top-list-value">${token.variableBorrowAPY.toFixed(2)}%</div>
                </div>
            `).join('')}
        </div>
    </div>
    
    <h2 class="section-title">Detailed Metrics</h2>
    
    <table>
        <thead>
            <tr>
                <th>Asset</th>
                <th>Reserves</th>
                <th>Reserve Factor</th>
                <th>Liquidation Threshold</th>
                <th>Supply Cap</th>
                <th>Borrow Cap</th>
                <th>Borrow Enabled</th>
            </tr>
        </thead>
        <tbody>
            ${sortedTokens.map(token => `
                <tr>
                    <td><strong>${token.token} (${token.symbol})</strong></td>
                    <td>$${!isNaN(token.reserves) ? formatNumber(token.reserves) : 'N/A'}</td>
                    <td>${token.reserveFactor.toFixed(2)}%</td>
                    <td>${token.liquidationThreshold.toFixed(2)}%</td>
                    <td>${token.supplyCap === Infinity ? 'Unlimited' : formatNumber(token.supplyCap)}</td>
                    <td>${token.borrowCap === Infinity ? 'Unlimited' : formatNumber(token.borrowCap)}</td>
                    <td>${token.borrowEnabled ? '<span class="pill pill-green">Yes</span>' : '<span class="pill pill-red">No</span>'}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    
    <div class="footer">
        <p>Generated by AAVE Metrics Indexer | Data from AAVE Base Market</p>
    </div>
</body>
</html>
  `;

  // Write to file
  fs.writeFileSync(reportFile, html);
  fs.writeFileSync(latestReportFile, html);

  console.log(`HTML report generated at ${reportFile}`);
  console.log(`Latest report available at ${latestReportFile}`);
}

// Helper function to format numbers with commas
function formatNumber(num) {
  if (isNaN(num) || num === undefined) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(num);
}

// Helper function to determine utilization class
function getUtilizationClass(rate) {
  if (rate < 40) return 'utilization-low';
  if (rate < 80) return 'utilization-medium';
  return 'utilization-high';
}

// Generate the report
generateHTMLReport(metricsData);

console.log('HTML report generation completed successfully');