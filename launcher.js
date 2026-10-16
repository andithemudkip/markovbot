const fs = require ('fs');
const { fork, exec } = require ('child_process');
const path = require ('path');
const { promisify } = require ('util');

const { admins } = require ('./config.json');
const download = require ('download');

const execAsync = promisify (exec);

const UPDATE_DIR = path.join (__dirname, 'update-temp');
const SHUTDOWN_TIMEOUT = 15 * 1000;
const MAX_RESTART_DELAY = 60 * 1000;
const STABLE_UPTIME = 60 * 1000;

let markov;
let justUpdated = false;
let updating = false;
let shuttingDown = false;
let crashCount = 0;
let restartTimer;

let consoleLog = (...arg) => console.log (`[${new Date ().toISOString ()}] `, ...arg);

const messageAdmins = message => {
    if (markov && markov.connected) markov.send ({ messageType: "MESSAGE-ADMINS", message });
    else consoleLog (`(could not message admins, markov is not running) ${message}`);
}

// Where a file from the update zip should be copied to, or null if it would end up outside the bot's folder
const updateDestination = filePath => {
    const dest = path.resolve (__dirname, filePath);
    return dest.startsWith (__dirname + path.sep) ? dest : null;
}

const handleUpdate = async msg => {
    if (!admins.includes (msg.author.id)) return;

    const { attachments } = msg;
    if (!attachments.length) {
        consoleLog ('no files provided');
        messageAdmins ('Received update command; no files provided.');
        return;
    }
    if (attachments.length !== 1 || !attachments [0].url.endsWith ('.zip')) {
        messageAdmins ('Updates must be a single .zip attachment.');
        return;
    }
    if (updating) {
        messageAdmins ('An update is already in progress.');
        return;
    }

    updating = true;
    consoleLog ('updating...');
    messageAdmins ('updating...');

    try {
        fs.rmSync (UPDATE_DIR, { recursive: true, force: true });
        const entries = await download (attachments [0].url, UPDATE_DIR, { extract: true });
        // Anything that can't be extracted comes back as the raw downloaded data instead of a file list
        if (!Array.isArray (entries)) throw new Error ('the attachment is not a valid zip file');

        const files = entries.filter (file => file.type === 'file');
        const unsafe = entries.filter (file => file.type !== 'directory' && (file.type !== 'file' || !updateDestination (file.path)));
        if (unsafe.length) {
            throw new Error (`refusing to update, the zip contains links or paths outside the bot folder: ${unsafe.map (file => file.path).join (', ')}`);
        }
        if (!files.length) throw new Error ('the zip contains no files');

        for (let file of files) {
            const src = path.join (UPDATE_DIR, file.path);
            const dest = updateDestination (file.path);
            consoleLog (`copy ${src} to ${dest}`);
            fs.mkdirSync (path.dirname (dest), { recursive: true });
            fs.copyFileSync (src, dest);
        }
    } catch (err) {
        consoleLog ('update failed', err);
        messageAdmins (`Update failed: ${err.message}`);
        updating = false;
        return;
    } finally {
        fs.rmSync (UPDATE_DIR, { recursive: true, force: true });
    }

    consoleLog ('update finished. checking npm packages. this may take a while.');
    try {
        const { stdout, stderr } = await execAsync ('npm install', { cwd: __dirname });
        consoleLog (`output:\n${stdout}`);
        if (stderr) consoleLog (`stderr: ${stderr}`);
    } catch (err) {
        consoleLog ('npm install failed', err);
        messageAdmins (`Update files were copied, but \`npm install\` failed, so MarkovBot was not restarted and is still running the old version:\n\`\`\`${String (err.message).slice (0, 1500)}\`\`\``);
        updating = false;
        return;
    }

    consoleLog ('restarting markov.');
    justUpdated = true;
    updating = false;
    await restartMarkov ();
}

const startMarkov = () => {
    const child = fork (path.join (__dirname, 'index.js'));
    const startedAt = Date.now ();
    markov = child;

    child.on ('message', msg => {
        switch (msg.messageType) {
            case 'UPDATE':
            handleUpdate (msg).catch (err => consoleLog ('update error', err));
            break;

            case 'READY':
            if (justUpdated) {
                consoleLog ('\nMARKOV HAS BEEN UPDATED\n');
                messageAdmins ('Update complete, MarkovBot has restarted.');
                justUpdated = false;
            }
            break;
        }
    });

    child.on ('exit', (code, signal) => {
        if (child.stopping || shuttingDown) return;

        // Restart after a crash, backing off if it keeps crashing right away (e.g. bad token)
        if (Date.now () - startedAt > STABLE_UPTIME) crashCount = 0;
        const delay = Math.min (1000 * 2 ** crashCount, MAX_RESTART_DELAY);
        crashCount++;
        consoleLog (`markov exited unexpectedly (code ${code}, signal ${signal}), restarting in ${delay / 1000}s`);
        restartTimer = setTimeout (startMarkov, delay);
    });
}

// Ask markov to save and exit, and wait for it; kill it if it doesn't exit in time.
// (On Windows, child.kill can't deliver signals and terminates immediately, so this goes over IPC.)
const stopMarkov = () => new Promise (resolve => {
    const child = markov;
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve ();

    child.stopping = true;
    const timer = setTimeout (() => {
        consoleLog ('markov did not exit in time, killing it');
        child.kill ('SIGKILL');
    }, SHUTDOWN_TIMEOUT);

    child.once ('exit', () => {
        clearTimeout (timer);
        resolve ();
    });

    if (child.connected) child.send ({ messageType: 'SHUTDOWN' });
    else child.kill ('SIGTERM');
});

const restartMarkov = async () => {
    clearTimeout (restartTimer);
    await stopMarkov ();
    startMarkov ();
}

const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout (restartTimer);
    consoleLog ('shutting down');
    await stopMarkov ();
    process.exit (0);
}

process.on ('SIGINT', shutdown);
process.on ('SIGTERM', shutdown);

startMarkov ();
