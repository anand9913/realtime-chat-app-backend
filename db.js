// db.js - Updated with Connection Test
const { Pool } = require('pg');
require('dotenv').config(); // For local dev

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("!!! DATABASE_URL environment variable not set. !!!");
    console.error("!!! Check Render Environment Variables.         !!!");
    console.error("!!! For local dev, set it in .env (EXTERNAL URL). !!!");
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    process.exit(1);
}

const pool = new Pool({
    connectionString: connectionString,
    // Ensure SSL is configured correctly for Render's free tier Postgres
    ssl: {
        rejectUnauthorized: false // Often required for cloud DBs like Render/Heroku
    }
});

pool.on('error', (err) => {
    // Pool-level errors
    console.error('!!! Unexpected error on idle PostgreSQL client !!!', err);
    process.exit(-1);
});

console.log("PostgreSQL Pool configured.");

// --- Add Eager Connection Test ---
async function testDbConnection() {
    let client = null; // Define client outside try/finally
    try {
        console.log("Attempting to connect to database to test connection...");
        client = await pool.connect(); // Get a client from the pool
        console.log(">>> Database test connection successful! Client acquired. <<<");

        // Optional: Run a simple query to be absolutely sure
        const res = await client.query('SELECT NOW()');
        console.log(">>> Test query successful. DB Current Time:", res.rows[0].now);

    } catch (err) {
        console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.error("!!! DATABASE CONNECTION FAILED ON TEST !!!", err.message);
        console.error("!!! Check DATABASE_URL, SSL settings, Network Rules, DB status. !!!");
        console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        // Don't necessarily exit here, maybe server can run without DB initially?
        // process.exit(1);
    } finally {
        // IMPORTANT: Release the client back to the pool ALWAYS
        if (client) {
            client.release();
            console.log("Test connection client released.");
        }
    }
}
// --- End Connection Test ---


// Export a query function and potentially the pool
module.exports = {
    query: (text, params) => pool.query(text, params),
    // pool: pool // Uncomment if direct pool access is needed
};

// --- Call the test function immediately after exporting ---
testDbConnection();
// ----------------------------------------------------------