// Settings for the bot and the launcher. Each comes from an environment variable (or a .env file next
// to this script), falling back to config.json if there is one, so the bot can run with either:
// config.json locally, environment variables on a host like Railway.
const fs = require ('fs');
const path = require ('path');

// Exit code telling the launcher (or host) that restarting won't help until the setup is fixed
const EXIT_CONFIG_ERROR = 78;

const fail = message => {
    console.error (message);
    process.exit (EXIT_CONFIG_ERROR);
}

try {
    process.loadEnvFile (path.join (__dirname, '.env'));
} catch (err) {
    if (err.code !== 'ENOENT') throw err;
}

let file = {};
const configPath = path.join (__dirname, 'config.json');
if (fs.existsSync (configPath)) {
    try {
        file = JSON.parse (fs.readFileSync (configPath, 'utf8'));
    } catch (err) {
        fail (`config.json is not valid JSON (${err.message}).`);
    }
}

const env = process.env;

const saveInterval = Number (env.SAVE_INTERVAL_SECONDS ?? file.updateServerFilesInterval ?? 60);
if (!(saveInterval > 0)) fail ('SAVE_INTERVAL_SECONDS (or updateServerFilesInterval in config.json) must be a positive number of seconds.');

module.exports = {
    EXIT_CONFIG_ERROR,
    fail,
    token: env.DISCORD_TOKEN,
    // Discord user ids allowed to use mk-update; ADMINS is comma-separated
    admins: env.ADMINS !== undefined ? env.ADMINS.split (',').map (id => id.trim ()).filter (Boolean) : (file.admins || []),
    replyToBots: env.REPLY_TO_BOTS !== undefined ? env.REPLY_TO_BOTS === 'true' : Boolean (file.replyToBots),
    // How often new messages and settings are saved, in seconds
    updateServerFilesInterval: saveInterval,
    // Where the message logs (servers/) and serverSettings.json live: DATA_DIR, else a Railway volume
    // if one is attached, else the bot's own folder
    dataDir: env.DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || __dirname
};
