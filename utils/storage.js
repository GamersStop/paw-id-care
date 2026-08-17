const fs = require('fs');
const path = require('path');
const snowflake = require('snowflake-sdk');

// Helper to read JSON data safely from data/ directory
function readJson(filename) {
    try {
        const filePath = path.join(__dirname, '..', 'data', filename);
        if (!fs.existsSync(filePath)) return [];
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (err) {
        console.error(`Error reading ${filename}:`, err.message);
        return [];
    }
}

// Helper to write JSON data safely to data/ directory
function writeJson(filename, data) {
    try {
        const filePath = path.join(__dirname, '..', 'data', filename);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error(`Error writing ${filename}:`, err.message);
        return false;
    }
}

// Calculate Herd Immunity Score
function calculateHerdImmunityScore() {
    const dogRegistry = readJson('dog_registry.json');
    if (dogRegistry.length === 0) return "0% Herd Immunity";
    const vaccinatedCount = dogRegistry.filter(d =>
        d.vaccinationStatus && d.vaccinationStatus.includes("Up-to-Date")
    ).length;
    const ratio = Math.round((vaccinatedCount / dogRegistry.length) * 100);
    return `${ratio}% (Community Herd Immunity Score)`;
}

// Lazy Snowflake Connection Pool Setup
let snowflakePool = null;
function getSnowflakePool() {
    if (!snowflakePool) {
        try {
            snowflakePool = snowflake.createPool({
                account: process.env.SNOWFLAKE_ACCOUNT || 'mock_account',
                username: process.env.SNOWFLAKE_USERNAME || 'mock_user',
                password: process.env.SNOWFLAKE_PASSWORD || 'mock_password',
                warehouse: process.env.SNOWFLAKE_WAREHOUSE || 'COMPUTE_WH',
                database: process.env.SNOWFLAKE_DATABASE || 'PAWID_DB',
                schema: process.env.SNOWFLAKE_SCHEMA || 'PUBLIC'
            }, { min: 1, max: 5 });
        } catch (e) {
            console.log("Snowflake pool init notice:", e.message);
        }
    }
    return snowflakePool;
}

function executeSnowflakeQuery(sqlText, binds = []) {
    return new Promise((resolve, reject) => {
        const pool = getSnowflakePool();
        if (!pool) return reject(new Error("Snowflake pool not available"));
        pool.use(async (client) => {
            client.execute({
                sqlText: sqlText,
                binds: binds,
                complete: (err, stmt, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            });
        });
    });
}

module.exports = {
    readJson,
    writeJson,
    calculateHerdImmunityScore,
    executeSnowflakeQuery
};
