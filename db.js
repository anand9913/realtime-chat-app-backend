// db.js - Updated with Export Logging (April 17, 2025)

const { Pool } = require('pg');
require('dotenv').config(); // For local dev using .env file

// Render automatically sets DATABASE_URL in the production environment
// For local development, set it in your .env file using the EXTERNAL connection string.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("!!! DATABASE_URL environment variable not set. !!!");
    console.error("!!! Check Render Environment Variables.         !!!");
    console.error("!!! For local dev, set it in .env (EXTERNAL URL). !!!");
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    process.exit(1); // Exit if DB connection is critical
}

// Create the PostgreSQL connection pool
const pool = new Pool({
    connectionString: connectionString,
    // Ensure SSL is configured correctly for Render's free tier Postgres
    ssl: {
        rejectUnauthorized: false // Often required for cloud DBs
    }
});

// Listener for pool-level errors (e.g., connection issues)
pool.on('error', (err, client) => {
    console.error('!!! Unexpected error on idle PostgreSQL client !!!', err);
    process.exit(-1); // Exit process on critical pool error
});

console.log("PostgreSQL Pool configured."); // Log that pool config object was created

// --- Eager Connection Test Function ---
// Tries to connect immediately on startup to verify credentials/settings
async function testDbConnection() {
    let client = null; // Define client outside try/finally
    try {
        console.log("Attempting to connect to database to test connection...");
        client = await pool.connect(); // Get a client from the pool
        console.log(">>> Database test connection successful! Client acquired. <<<");

        // Optional: Run a simple query
        const res = await client.query('SELECT NOW() as currentTime');
        console.log(">>> Test query successful. DB Current Time:", res.rows[0].currenttime);

    } catch (err) {
        console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.error("!!! DATABASE CONNECTION FAILED ON TEST !!!", err); // Log the full error
        console.error("!!! Check DATABASE_URL, SSL settings, Network Rules, DB status in Render. !!!");
        console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        // Decide if you want to exit if the DB isn't available at start
        // process.exit(1);
    } finally {
        // IMPORTANT: Always release the client back to the pool
        if (client) {
            client.release();
            console.log("Test connection client released.");
        }
    }
}
// --- End Connection Test Function ---


// Prepare the object to be exported
const exportedObject = {
    // Function to run simple queries using a client from the pool
    query: (text, params) => pool.query(text, params),
    // Export the pool itself for transactions or direct access if needed
    pool: pool
};

// *** ADDED LOGGING before export ***
console.log("db.js: Final object being exported:", exportedObject);
// Check if pool exists right before export
if (exportedObject.pool && typeof exportedObject.pool.connect === 'function') {
    console.log("db.js: pool property with connect method EXISTS on exported object.");
} else {
    console.error("!!! db.js: pool property or pool.connect method MISSING on exported object right before export !!!", exportedObject);
}
// *** END ADDED LOGGING ***

// Export the prepared object
module.exports = exportedObject;

// --- Call the test function immediately after module exports are set up ---
// This runs when the module is first required by server.js
testDbConnection();
// ------------------------------------------------------------------------