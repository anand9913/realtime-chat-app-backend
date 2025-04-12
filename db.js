// db.js
const { Pool } = require('pg');
require('dotenv').config(); // Ensures .env is loaded for local dev if needed

// Render automatically sets DATABASE_URL in the production environment
// For local development, you might need to set it in your .env file
// using the EXTERNAL connection string from Render.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("!!! DATABASE_URL environment variable not set. !!!");
    console.error("!!! Make sure your Render database is provisioned  !!!");
    console.error("!!! and the variable is available in your env.   !!!");
    console.error("!!! For local dev, set it in .env using EXTERNAL URL. !!!");
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    // Exit if DB connection is critical for server startup
    process.exit(1);
}

const pool = new Pool({
    connectionString: connectionString,
    // Render's free tier PostgreSQL requires SSL
    // The 'pg' library usually enables SSL automatically if connection string starts with postgres://... and has ssl=true or no ssl param
    // Render's internal URL might handle this, but explicitly enabling might be safer for external connections or if issues arise.
    // Check Render docs for specifics on current SSL requirements for Node pg.
    // For many cloud providers including Render/Heroku, this might be needed:
     ssl: {
        rejectUnauthorized: false
     }
});

pool.on('connect', () => {
    console.log('Successfully connected to PostgreSQL database!');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
    process.exit(-1); // Exit process on critical pool error
});

console.log("PostgreSQL Pool configured.");

// Export a query function to easily run queries
module.exports = {
    query: (text, params) => pool.query(text, params),
    // You might export the pool itself if you need transactions
    // pool: pool
};